
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  Injector,
  NgZone,
  OnDestroy,
  OnInit,
  runInInjectionContext
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  Auth,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut,
  updatePassword
} from '@angular/fire/auth';

import {
  Firestore,
  doc,
  getDoc,
  updateDoc
} from '@angular/fire/firestore';

import Swal from 'sweetalert2';

interface NotificationPreferences {
  newOrders: boolean;
  deliveryUpdates: boolean;
  lowInventory: boolean;
  staffApplications: boolean;
}

interface StaffProfile {
  fullName?: string;
  email?: string;
  mobileNumber?: string;
  completeAddress?: string;
  role?: string;
  createdAt?: any;
  updatedAt?: any;
  isActive?: boolean;
  notificationPreferences?: Partial<NotificationPreferences>;
}

@Component({
  selector: 'app-profile-adm',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-adm.html',
  styleUrl: './profile-adm.scss'
})
export class ProfileAdm implements OnInit, OnDestroy {

  authResolved = false;
  profileLoading = false;
  isSignedIn = false;
  isAuthorized = false;

  uid = '';
  fullName = '';
  email = '';
  mobileNumber = '';
  completeAddress = '';
  role = '';
  memberSince = '';
  lastUpdated = '';

  editMode = false;
  editFullName = '';
  editMobileNumber = '';
  editCompleteAddress = '';

  saving = false;
  loggingOut = false;

  // SETTINGS
  showSettings = false;
  showPasswordForm = false;
  changingPassword = false;

  // PASSWORD
  currentPassword = '';
  newPassword = '';
  confirmNewPassword = '';
  passwordError = '';

  // PASSWORD VISIBILITY
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;

  // SECURITY
  lastSignIn = 'Not available';
  accountCreated = 'Not available';
  loginProvider = 'Not available';

  // NOTIFICATION PREFERENCES
  notificationPreferences: NotificationPreferences = {
    newOrders: true,
    deliveryUpdates: true,
    lowInventory: true,
    staffApplications: true
  };

  savingPreferences = false;
  notificationSuccess = '';
  notificationError = '';

  successMessage = '';
  errorMessage = '';

  private unsubscribeAuth: (() => void) | null = null;
  private sessionId = 0;
  private destroyed = false;

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private router: Router,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  private inContext<T>(callback: () => T): T {
    return runInInjectionContext(this.injector, callback);
  }

  private refresh(): void {
    if (!this.destroyed) {
      this.cdr.detectChanges();
    }
  }

  private defaultNotificationPreferences(): NotificationPreferences {
    return {
      newOrders: true,
      deliveryUpdates: true,
      lowInventory: true,
      staffApplications: true
    };
  }

  // AUTHENTICATION
  ngOnInit(): void {
    this.destroyed = false;

    this.unsubscribeAuth = this.inContext(() =>
      onAuthStateChanged(
        this.auth,
        user => this.zone.run(() => {
          const session = ++this.sessionId;

          this.resetProfile();
          this.authResolved = true;

          if (!user) {
            this.isSignedIn = false;
            this.errorMessage =
              'Please sign in with your Admin or Staff account.';
            this.refresh();
            return;
          }

          this.isSignedIn = true;
          this.uid = user.uid;
          this.email = user.email || '';

          // FIREBASE SECURITY METADATA
          this.lastSignIn = this.formatAuthDate(
            user.metadata.lastSignInTime
          );

          this.accountCreated = this.formatAuthDate(
            user.metadata.creationTime
          );

          const providers = user.providerData.map(
            provider => provider.providerId
          );

          this.loginProvider = providers.includes('password')
            ? 'Email and Password'
            : providers.includes('google.com')
              ? 'Google'
              : providers.length
                ? providers.join(', ')
                : 'Not available';

          this.refresh();
          void this.loadProfile(session);
        }),
        error => this.zone.run(() => {
          this.authResolved = true;
          this.errorMessage = 'Unable to verify your account.';
          console.error(error);
          this.refresh();
        })
      )
    );
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.sessionId++;
    this.unsubscribeAuth?.();
  }

  // RESET PROFILE
  private resetProfile(): void {
    this.uid = '';
    this.fullName = '';
    this.email = '';
    this.mobileNumber = '';
    this.completeAddress = '';
    this.role = '';
    this.memberSince = '';
    this.lastUpdated = '';

    this.isAuthorized = false;
    this.isSignedIn = false;
    this.profileLoading = false;
    this.editMode = false;
    this.saving = false;

    this.showSettings = false;
    this.showPasswordForm = false;
    this.changingPassword = false;
    this.clearPasswordFields();

    this.lastSignIn = 'Not available';
    this.accountCreated = 'Not available';
    this.loginProvider = 'Not available';

    this.notificationPreferences =
      this.defaultNotificationPreferences();

    this.savingPreferences = false;
    this.notificationSuccess = '';
    this.notificationError = '';

    this.successMessage = '';
    this.errorMessage = '';
  }

  // PROFILE GETTERS
  get profileInitial(): string {
    const text = this.fullName || this.email || 'S';
    return text.trim().charAt(0).toUpperCase();
  }

  get roleLabel(): string {
    const role = this.role.toLowerCase();

    if (role === 'administrator' || role === 'admin') {
      return 'Administrator';
    }

    if (role === 'staff') {
      return 'Staff';
    }

    return 'Unauthorized';
  }

  get isAdministrator(): boolean {
    return ['admin', 'administrator'].includes(
      this.role.toLowerCase()
    );
  }

  get accountStatus(): string {
    return this.isAuthorized
      ? 'Authorized'
      : 'Not Authorized';
  }

  get displayName(): string {
    if (this.fullName) return this.fullName;
    if (this.email) return this.email.split('@')[0];
    return 'SilkMart Staff';
  }

  // LOAD PROFILE
  async loadProfile(
    session: number = this.sessionId
  ): Promise<void> {
    if (!this.uid) return;

    const userId = this.uid;

    this.profileLoading = true;
    this.errorMessage = '';
    this.refresh();

    try {
      const snapshot = await this.inContext(() =>
        getDoc(doc(this.firestore, 'users', userId))
      );

      this.zone.run(() => {
        if (
          session !== this.sessionId ||
          userId !== this.uid
        ) return;

        if (!snapshot.exists()) {
          this.isAuthorized = false;
          this.errorMessage =
            'Your staff profile was not found in Firestore.';
          return;
        }

        const profile = snapshot.data() as StaffProfile;

        this.role = String(profile.role || '')
          .trim()
          .toLowerCase();

        this.isAuthorized = [
          'admin',
          'administrator',
          'staff'
        ].includes(this.role);

        if (!this.isAuthorized) {
          this.errorMessage =
            'This page is only available to authorized Admin or Staff accounts.';
          return;
        }

        this.fullName = profile.fullName || '';
        this.email = profile.email || this.email;
        this.mobileNumber = profile.mobileNumber || '';
        this.completeAddress = profile.completeAddress || '';

        this.memberSince = this.formatDate(profile.createdAt);
        this.lastUpdated = this.formatDate(profile.updatedAt);

        // LOAD FIRESTORE NOTIFICATION PREFERENCES
        const saved = profile.notificationPreferences;

        this.notificationPreferences = {
          newOrders:
            typeof saved?.newOrders === 'boolean'
              ? saved.newOrders : true,

          deliveryUpdates:
            typeof saved?.deliveryUpdates === 'boolean'
              ? saved.deliveryUpdates : true,

          lowInventory:
            typeof saved?.lowInventory === 'boolean'
              ? saved.lowInventory : true,

          staffApplications:
            typeof saved?.staffApplications === 'boolean'
              ? saved.staffApplications : true
        };

        this.refresh();
      });

    } catch (error: any) {
      console.error('Profile load error:', error);

      this.zone.run(() => {
        if (session !== this.sessionId) return;

        this.errorMessage =
          error?.code === 'permission-denied'
            ? 'Firebase denied access to your profile.'
            : 'Unable to load your staff profile.';

        this.refresh();
      });

    } finally {
      this.zone.run(() => {
        if (session !== this.sessionId) return;
        this.profileLoading = false;
        this.refresh();
      });
    }
  }

  // PROFILE EDITING
  enableEdit(): void {
    if (
      !this.isAuthorized ||
      this.profileLoading ||
      this.saving
    ) return;

    this.editFullName = this.fullName;
    this.editMobileNumber = this.mobileNumber;
    this.editCompleteAddress = this.completeAddress;

    this.successMessage = '';
    this.errorMessage = '';
    this.editMode = true;
  }

  cancelEdit(): void {
    if (this.saving) return;

    this.editMode = false;
    this.successMessage = '';
    this.errorMessage = '';
  }

  async saveProfile(): Promise<void> {
    if (!this.uid || !this.isAuthorized || this.saving) {
      return;
    }

    const fullName = this.editFullName.trim();
    const mobileNumber = this.editMobileNumber.trim();
    const completeAddress = this.editCompleteAddress.trim();

    this.successMessage = '';
    this.errorMessage = '';

    if (!fullName) {
      this.errorMessage = 'Full name is required.';
      return;
    }

    if (fullName.length > 120) {
      this.errorMessage =
        'Full name must be 120 characters or fewer.';
      return;
    }

    if (mobileNumber.length > 30) {
      this.errorMessage = 'Mobile number is too long.';
      return;
    }

    if (
      mobileNumber &&
      !/^[0-9+\s()-]{7,30}$/.test(mobileNumber)
    ) {
      this.errorMessage = 'Please enter a valid mobile number.';
      return;
    }

    if (completeAddress.length > 500) {
      this.errorMessage =
        'Address must be 500 characters or fewer.';
      return;
    }

    const userId = this.uid;
    const session = this.sessionId;

    this.saving = true;
    this.refresh();

    try {
      await this.inContext(() =>
        updateDoc(doc(this.firestore, 'users', userId), {
          fullName,
          mobileNumber,
          completeAddress
        })
      );

      this.zone.run(() => {
        if (
          session !== this.sessionId ||
          userId !== this.uid
        ) return;

        this.fullName = fullName;
        this.mobileNumber = mobileNumber;
        this.completeAddress = completeAddress;

        this.editMode = false;
        this.successMessage =
          'Your profile has been updated successfully.';

        this.refresh();
      });

    } catch (error: any) {
      console.error('Profile update error:', error);

      this.zone.run(() => {
        if (session !== this.sessionId) return;

        this.errorMessage =
          error?.code === 'permission-denied'
            ? 'Firebase denied this update. Check your profile security rules.'
            : 'Unable to save your profile changes.';

        this.refresh();
      });

    } finally {
      this.zone.run(() => {
        if (session !== this.sessionId) return;
        this.saving = false;
        this.refresh();
      });
    }
  }

  // DATE FORMATTING
  formatDate(value: any): string {
    if (!value) return 'Not available';

    try {
      let date: Date;

      if (typeof value.toDate === 'function') {
        date = value.toDate();
      } else if (typeof value.seconds === 'number') {
        date = new Date(value.seconds * 1000);
      } else {
        date = new Date(value);
      }

      if (!Number.isFinite(date.getTime())) {
        return 'Not available';
      }

      return date.toLocaleDateString('en-PH', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });

    } catch {
      return 'Not available';
    }
  }

  formatAuthDate(value?: string): string {
    if (!value) return 'Not available';

    const date = new Date(value);

    if (!Number.isFinite(date.getTime())) {
      return 'Not available';
    }

    return date.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  // STAFF NAVIGATION
  goToInventory(): void {
    if (!this.isAuthorized) return;
    void this.router.navigate(['/home-adm/inventory']);
  }

  goToProducts(): void {
    if (!this.isAuthorized) return;
    void this.router.navigate(['/home-adm/products']);
  }

  goToCustomerOrders(): void {
    if (!this.isAuthorized) return;
    void this.router.navigate(['/home-adm/cust-order']);
  }

  // SETTINGS MODAL
  openSettings(): void {
    if (
      !this.isAuthorized ||
      this.loggingOut ||
      this.changingPassword ||
      this.savingPreferences
    ) return;

    this.showSettings = true;
    this.showPasswordForm = false;
    this.notificationSuccess = '';
    this.notificationError = '';
    this.clearPasswordFields();
  }

  closeSettings(): void {
    if (
      this.changingPassword ||
      this.loggingOut ||
      this.savingPreferences
    ) return;

    this.showSettings = false;
    this.showPasswordForm = false;
    this.clearPasswordFields();
  }

  togglePasswordForm(): void {
    if (
      this.changingPassword ||
      this.loggingOut ||
      this.savingPreferences
    ) return;

    this.showPasswordForm = !this.showPasswordForm;
    this.clearPasswordFields();
  }

  private clearPasswordFields(): void {
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmNewPassword = '';
    this.passwordError = '';

    this.showCurrentPassword = false;
    this.showNewPassword = false;
    this.showConfirmPassword = false;
  }

  // SAVE NOTIFICATION PREFERENCES
  async saveNotificationPreferences(): Promise<void> {
    if (
      !this.uid ||
      !this.isAuthorized ||
      this.savingPreferences
    ) return;

    const userId = this.uid;
    const session = this.sessionId;

    const preferences: NotificationPreferences = {
      newOrders: this.notificationPreferences.newOrders,
      deliveryUpdates:
        this.notificationPreferences.deliveryUpdates,
      lowInventory:
        this.notificationPreferences.lowInventory,
      staffApplications:
        this.notificationPreferences.staffApplications
    };

    this.savingPreferences = true;
    this.notificationSuccess = '';
    this.notificationError = '';
    this.refresh();

    try {
      await this.inContext(() =>
        updateDoc(
          doc(this.firestore, 'users', userId),
          {
            notificationPreferences: preferences
          }
        )
      );

      if (
        session !== this.sessionId ||
        userId !== this.uid
      ) return;

      this.notificationSuccess =
        'Your notification preferences have been saved.';

      this.refresh();

    } catch (error: any) {
      console.error('Notification preferences error:', error);

      if (
        session !== this.sessionId ||
        userId !== this.uid
      ) return;

      this.notificationError =
        error?.code === 'permission-denied'
          ? 'Firebase denied this update. Check your Firestore rules.'
          : 'Unable to save preferences. Please try again.';

      this.refresh();

    } finally {
      this.savingPreferences = false;

      if (session === this.sessionId) {
        this.refresh();
      }
    }
  }

  // CHANGE PASSWORD
  async changePassword(): Promise<void> {
    if (
      this.changingPassword ||
      !this.isAuthorized
    ) return;

    const user = this.auth.currentUser;

    if (
      !user ||
      !user.email ||
      user.uid !== this.uid
    ) {
      this.passwordError =
        'Your session is no longer valid. Please sign in again.';
      return;
    }

    if (
      !this.currentPassword ||
      !this.newPassword ||
      !this.confirmNewPassword
    ) {
      this.passwordError =
        'Please complete all password fields.';
      return;
    }

    if (this.newPassword.length < 8) {
      this.passwordError =
        'Your new password must contain at least 8 characters.';
      return;
    }

    if (this.newPassword !== this.confirmNewPassword) {
      this.passwordError =
        'New passwords do not match.';
      return;
    }

    if (this.newPassword === this.currentPassword) {
      this.passwordError =
        'Your new password must be different from your current password.';
      return;
    }

    const session = this.sessionId;

    this.changingPassword = true;
    this.passwordError = '';
    this.refresh();

    try {
      const credential = EmailAuthProvider.credential(
        user.email,
        this.currentPassword
      );

      await this.inContext(() =>
        reauthenticateWithCredential(user, credential)
      );

      if (
        session !== this.sessionId ||
        this.auth.currentUser?.uid !== user.uid
      ) return;

      await this.inContext(() =>
        updatePassword(user, this.newPassword)
      );

      if (session !== this.sessionId) return;

      this.changingPassword = false;
      this.clearPasswordFields();
      this.showPasswordForm = false;
      this.showSettings = false;
      this.refresh();

      await Swal.fire({
        icon: 'success',
        title: 'Password Updated',
        text: 'Your account password has been changed successfully.',
        confirmButtonColor: '#287156',
        heightAuto: false
      });

    } catch (error: any) {
      console.error('Password update error:', error);

      if (session !== this.sessionId) return;

      const code = String(error?.code || '');

      if (
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential'
      ) {
        this.passwordError =
          'Your current password is incorrect.';

      } else if (code === 'auth/weak-password') {
        this.passwordError =
          'Please choose a stronger password.';

      } else if (code === 'auth/too-many-requests') {
        this.passwordError =
          'Too many attempts. Please try again later.';

      } else if (code === 'auth/requires-recent-login') {
        this.passwordError =
          'Please sign in again before changing your password.';

      } else if (code === 'auth/network-request-failed') {
        this.passwordError =
          'Please check your internet connection.';

      } else {
        this.passwordError =
          'Unable to update your password. Please try again.';
      }

      this.currentPassword = '';
      this.showCurrentPassword = false;
      this.refresh();

    } finally {
      this.changingPassword = false;

      if (session === this.sessionId) {
        this.refresh();
      }
    }
  }

  // LOGOUT
  async logout(): Promise<void> {
    if (
      this.loggingOut ||
      this.changingPassword ||
      this.savingPreferences
    ) return;

    const wasSettingsOpen = this.showSettings;

    this.showSettings = false;
    this.refresh();

    const confirmation = await Swal.fire({
      icon: 'question',
      title: 'Log out of SilkMart?',
      text: 'You will be signed out of your staff account.',
      showCancelButton: true,
      confirmButtonText: 'Log Out',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#287156',
      reverseButtons: true,
      heightAuto: false
    });

    if (!confirmation.isConfirmed) {
      this.showSettings = wasSettingsOpen;
      this.refresh();
      return;
    }

    this.loggingOut = true;

    try {
      await this.inContext(() => signOut(this.auth));

      sessionStorage.removeItem('silkmartGuestMode');

      this.showSettings = false;
      this.clearPasswordFields();

      await this.router.navigateByUrl('/');

    } catch (error) {
      console.error('Logout error:', error);

      await Swal.fire({
        icon: 'error',
        title: 'Logout Failed',
        text: 'Unable to sign out. Please try again.',
        confirmButtonColor: '#287156',
        heightAuto: false
      });

      this.showSettings = wasSettingsOpen;

    } finally {
      this.loggingOut = false;
    }
  }
}
