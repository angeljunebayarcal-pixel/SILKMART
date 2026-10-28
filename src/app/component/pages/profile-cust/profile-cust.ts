
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
  updatePassword,
  User
} from '@angular/fire/auth';

import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

import { AuthServ } from '../../../services/auth.serv';
import { UserServ } from '../../../services/user.serv';

import {
  OrderServ,
  SilkMartOrder
} from '../../../services/order.serv';

interface RecentOrder {
  id: string;
  name: string;
  total: number;
  status: string;
  orderDate: string;
}

@Component({
  selector: 'app-profile-cust',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-cust.html',
  styleUrl: './profile-cust.scss'
})
export class ProfileCust implements OnInit, OnDestroy {

  // AUTHENTICATION
  isGuest = true;
  authResolved = false;
  profileLoading = false;

  // PROFILE INFORMATION
  uid = '';
  fullName = '';
  email = '';
  mobileNumber = '';
  completeAddress = '';
  role = 'customer';
  memberSince = 'Not available';

  // EDIT PROFILE
  editMode = false;
  editFullName = '';
  editMobileNumber = '';
  editCompleteAddress = '';

  saving = false;
  successMessage = '';
  errorMessage = '';

  // RECENT ORDERS
  recentOrders: RecentOrder[] = [];
  ordersLoading = false;
  ordersError = '';

  // AUTHENTICATION POPUP
  showAuthPopup = false;
  authMode: 'login' | 'register' = 'login';
  authLoading = false;
  authError = '';

  authEmail = '';
  authPassword = '';
  showAuthPassword = false;

  // REGISTRATION
  registerFullName = '';
  registerEmail = '';
  registerMobile = '';
  registerAddress = '';
  registerPassword = '';
  registerConfirmPassword = '';

  registerLoading = false;
  showRegisterPassword = false;
  showConfirmPassword = false;

  // SETTINGS MODAL
  showSettings = false;
  showPasswordForm = false;
  changingPassword = false;
  loggingOut = false;

  // CHANGE PASSWORD
  currentPassword = '';
  newPassword = '';
  confirmNewPassword = '';
  passwordError = '';

  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmNewPassword = false;

  // FIREBASE ACCOUNT INFORMATION
  accountCreated = 'Not available';
  lastSignIn = 'Not available';
  loginProvider = 'Not available';

  // LIFECYCLE
  private authUnsubscribe: (() => void) | null = null;
  private ordersSubscription: Subscription | null = null;
  private sessionId = 0;
  private destroyed = false;

  constructor(
    private auth: Auth,
    private authService: AuthServ,
    private userService: UserServ,
    private orderService: OrderServ,
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

  // COMPONENT LIFECYCLE
  ngOnInit(): void {
    this.loadAuthenticatedUser();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.sessionId++;

    this.authUnsubscribe?.();
    this.ordersSubscription?.unsubscribe();
  }

  // PROFILE INITIAL
  get profileInitial(): string {
    const value = this.fullName || this.email || 'Customer';
    return value.trim().charAt(0).toUpperCase();
  }

  // RESET CUSTOMER PROFILE
  clearProfile(): void {
    this.uid = '';
    this.fullName = '';
    this.email = '';
    this.mobileNumber = '';
    this.completeAddress = '';
    this.role = 'customer';
    this.memberSince = 'Not available';

    this.editMode = false;
    this.editFullName = '';
    this.editMobileNumber = '';
    this.editCompleteAddress = '';

    this.saving = false;
    this.successMessage = '';
    this.errorMessage = '';

    this.recentOrders = [];
    this.ordersLoading = false;
    this.ordersError = '';

    this.showSettings = false;
    this.showPasswordForm = false;
    this.clearPasswordFields();

    this.accountCreated = 'Not available';
    this.lastSignIn = 'Not available';
    this.loginProvider = 'Not available';
  }

  // GUEST MODE
  setGuestMode(): void {
    this.sessionId++;

    this.ordersSubscription?.unsubscribe();
    this.ordersSubscription = null;

    this.isGuest = true;
    this.authResolved = true;
    this.profileLoading = false;

    this.clearProfile();
    this.refresh();
  }

  // AUTHENTICATION LISTENER
  loadAuthenticatedUser(): void {
    this.authUnsubscribe?.();

    this.authUnsubscribe = this.inContext(() =>
      onAuthStateChanged(
        this.auth,

        user => this.zone.run(() => {
          if (this.destroyed) return;

          const guestMode =
            sessionStorage.getItem('silkmartGuestMode');

          if (!user || guestMode === 'true') {
            if (!this.isGuest || !this.authResolved) {
              this.setGuestMode();
            }
            return;
          }

          this.applyAuthenticatedUser(user);
        }),

        error => this.zone.run(() => {
          console.error('Authentication error:', error);
          this.setGuestMode();
        })
      )
    );
  }

  // SET AUTHENTICATED CUSTOMER
  private applyAuthenticatedUser(user: User): void {
    const changedUser =
      this.isGuest || this.uid !== user.uid;

    if (changedUser) {
      this.sessionId++;

      this.ordersSubscription?.unsubscribe();
      this.ordersSubscription = null;

      this.clearProfile();
    }

    this.isGuest = false;
    this.authResolved = true;

    this.uid = user.uid;
    this.email = user.email || '';

    this.accountCreated = this.formatAuthDate(
      user.metadata.creationTime
    );

    this.lastSignIn = this.formatAuthDate(
      user.metadata.lastSignInTime
    );

    const providers = user.providerData.map(
      provider => provider.providerId
    );

    this.loginProvider = providers.length
      ? providers.map(provider =>
          provider === 'password'
            ? 'Email and Password'
            : provider === 'google.com'
              ? 'Google'
              : provider
        ).join(', ')
      : 'Not available';

    this.refresh();

    if (changedUser) {
      void this.loadProfile();
      this.loadRecentOrders();
    }
  }

  // LOAD PROFILE FROM USER SERVICE
  async loadProfile(): Promise<void> {
    if (this.isGuest || !this.uid) return;

    const uid = this.uid;
    const session = this.sessionId;

    this.profileLoading = true;
    this.errorMessage = '';
    this.refresh();

    try {
      const profile =
        await this.userService.getUserProfile(uid);

      if (
        session !== this.sessionId ||
        uid !== this.uid ||
        this.isGuest
      ) return;

      if (!profile) {
        this.errorMessage =
          'Customer profile information could not be found.';
        return;
      }

      this.fullName = profile.fullName || '';
      this.mobileNumber = profile.mobileNumber || '';
      this.completeAddress = profile.completeAddress || '';
      this.role = profile.role || 'customer';

      this.memberSince = this.formatCreatedDate(
        profile.createdAt
      );

    } catch (error) {
      console.error('Profile load error:', error);

      if (session === this.sessionId) {
        this.errorMessage =
          'Unable to load your customer profile.';
      }

    } finally {
      if (session === this.sessionId) {
        this.profileLoading = false;
        this.refresh();
      }
    }
  }

  // DATE FORMATTING
  formatCreatedDate(value: any): string {
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
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  // EDIT PERSONAL INFORMATION
  enableEdit(): void {
    if (
      this.isGuest ||
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

  // SAVE PERSONAL INFORMATION
  async saveProfile(): Promise<void> {
    if (
      this.isGuest ||
      !this.uid ||
      this.saving
    ) return;

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

    if (
      mobileNumber &&
      !/^[0-9+\s()-]{7,30}$/.test(mobileNumber)
    ) {
      this.errorMessage =
        'Please enter a valid mobile number.';
      return;
    }

    if (completeAddress.length > 500) {
      this.errorMessage =
        'Address must be 500 characters or fewer.';
      return;
    }

    const uid = this.uid;
    const session = this.sessionId;

    this.saving = true;
    this.refresh();

    try {
      await this.userService.updateUserProfile(
        uid,
        {
          fullName,
          mobileNumber,
          completeAddress
        }
      );

      if (
        session !== this.sessionId ||
        uid !== this.uid
      ) return;

      this.fullName = fullName;
      this.mobileNumber = mobileNumber;
      this.completeAddress = completeAddress;

      this.editMode = false;
      this.successMessage =
        'Your profile has been updated successfully.';

    } catch (error) {
      console.error('Profile update error:', error);

      if (session === this.sessionId) {
        this.errorMessage =
          'Unable to save your profile changes.';
      }

    } finally {
      if (session === this.sessionId) {
        this.saving = false;
        this.refresh();
      }
    }
  }

  // LOAD RECENT ORDERS FROM FIRESTORE
  loadRecentOrders(): void {
    this.ordersSubscription?.unsubscribe();
    this.ordersSubscription = null;

    if (this.isGuest || !this.uid) {
      this.recentOrders = [];
      this.ordersLoading = false;
      return;
    }

    const uid = this.uid;
    const session = this.sessionId;

    this.ordersLoading = true;
    this.ordersError = '';
    this.refresh();

    this.ordersSubscription = this.inContext(() =>
      this.orderService.getMyOrders().subscribe({
        next: (orders: SilkMartOrder[]) => {
          this.zone.run(() => {
            if (
              session !== this.sessionId ||
              uid !== this.uid ||
              this.isGuest
            ) return;

            const myOrders = orders
              .filter(order => order.customerId === uid)
              .sort(
                (a, b) =>
                  this.getOrderTime(b.createdAt) -
                  this.getOrderTime(a.createdAt)
              );

            this.recentOrders = myOrders
              .slice(0, 1)
              .map(order => ({
                id: order.id,
                name:
                  order.items
                    .map(item => item.name)
                    .filter(Boolean)
                    .join(', ') || 'SilkMart Order',
                total: Number(order.total || 0),
                status: order.status,
                orderDate:
                  this.formatCreatedDate(order.createdAt)
              }));

            this.ordersLoading = false;
            this.ordersError = '';
            this.refresh();
          });
        },

        error: error => {
          this.zone.run(() => {
            if (session !== this.sessionId) return;

            console.error('Order loading error:', error);

            this.recentOrders = [];
            this.ordersLoading = false;
            this.ordersError =
              'Unable to load your recent orders.';

            this.refresh();
          });
        }
      })
    );
  }

  private getOrderTime(value: any): number {
    if (!value) return 0;

    if (typeof value.toDate === 'function') {
      return value.toDate().getTime();
    }

    if (typeof value.seconds === 'number') {
      return value.seconds * 1000;
    }

    const date = new Date(value);

    return Number.isFinite(date.getTime())
      ? date.getTime()
      : 0;
  }

  // GUEST AUTHENTICATION POPUP
  goToLogin(): void {
    this.authMode = 'login';
    this.authError = '';
    this.showAuthPopup = true;
  }

  goToCreateAccount(): void {
    this.authMode = 'register';
    this.authError = '';
    this.showAuthPopup = true;
  }

  closeAuthPopup(): void {
    if (
      this.authLoading ||
      this.registerLoading
    ) return;

    this.showAuthPopup = false;
    this.authError = '';
    this.showAuthPassword = false;
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  showLoginMode(): void {
    if (this.registerLoading) return;

    this.authMode = 'login';
    this.authError = '';
  }

  showRegisterMode(): void {
    if (this.authLoading) return;

    this.authMode = 'register';
    this.authError = '';
  }

  toggleAuthPassword(): void {
    this.showAuthPassword = !this.showAuthPassword;
  }

  toggleRegisterPassword(): void {
    this.showRegisterPassword = !this.showRegisterPassword;
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // CUSTOMER SIGN IN
  async signInFromProfile(): Promise<void> {
    if (this.authLoading) return;

    this.authError = '';

    if (
      !this.authEmail.trim() ||
      !this.authPassword
    ) {
      this.authError =
        'Please enter your email and password.';
      return;
    }

    this.authLoading = true;
    this.refresh();

    try {
      const result = await this.authService.login(
        this.authEmail.trim(),
        this.authPassword
      );

      sessionStorage.removeItem('silkmartGuestMode');

      this.showAuthPopup = false;
      this.authEmail = '';
      this.authPassword = '';
      this.showAuthPassword = false;

      this.applyAuthenticatedUser(result.user);

    } catch (error: any) {
      console.error('Customer sign-in error:', error);

      switch (error?.code) {
        case 'auth/invalid-email':
          this.authError =
            'Please enter a valid email address.';
          break;

        case 'auth/invalid-credential':
        case 'auth/wrong-password':
          this.authError =
            'Incorrect email or password.';
          break;

        case 'auth/user-disabled':
          this.authError =
            'This account has been disabled.';
          break;

        case 'auth/too-many-requests':
          this.authError =
            'Too many attempts. Try again later.';
          break;

        case 'auth/network-request-failed':
          this.authError =
            'Please check your internet connection.';
          break;

        default:
          this.authError =
            'Unable to sign in. Please try again.';
      }

    } finally {
      this.authLoading = false;
      this.refresh();
    }
  }

  // CUSTOMER REGISTRATION
  async createAccountFromProfile(): Promise<void> {
    if (this.registerLoading) return;

    this.authError = '';

    if (
      !this.registerFullName.trim() ||
      !this.registerEmail.trim() ||
      !this.registerMobile.trim() ||
      !this.registerAddress.trim() ||
      !this.registerPassword ||
      !this.registerConfirmPassword
    ) {
      this.authError =
        'Please complete all required fields.';
      return;
    }

    if (
      this.registerPassword !==
      this.registerConfirmPassword
    ) {
      this.authError =
        'Passwords do not match.';
      return;
    }

    if (this.registerPassword.length < 6) {
      this.authError =
        'Password must contain at least 6 characters.';
      return;
    }

    this.registerLoading = true;
    this.refresh();

    try {
      const result = await this.authService.register(
        this.registerEmail.trim().toLowerCase(),
        this.registerPassword
      );

      await this.userService.createUserProfile(
        result.user.uid,
        {
          fullName: this.registerFullName.trim(),
          email: this.registerEmail.trim().toLowerCase(),
          mobileNumber: this.registerMobile.trim(),
          completeAddress: this.registerAddress.trim(),
          role: 'customer'
        }
      );

      sessionStorage.removeItem('silkmartGuestMode');

      this.showAuthPopup = false;

      this.registerFullName = '';
      this.registerEmail = '';
      this.registerMobile = '';
      this.registerAddress = '';
      this.registerPassword = '';
      this.registerConfirmPassword = '';

      this.showRegisterPassword = false;
      this.showConfirmPassword = false;

      this.applyAuthenticatedUser(result.user);

    } catch (error: any) {
      console.error('Customer registration error:', error);

      switch (error?.code) {
        case 'auth/email-already-in-use':
          this.authError =
            'This email address already has an account.';
          break;

        case 'auth/invalid-email':
          this.authError =
            'Please enter a valid email address.';
          break;

        case 'auth/weak-password':
          this.authError =
            'Please choose a stronger password.';
          break;

        case 'auth/network-request-failed':
          this.authError =
            'Please check your internet connection.';
          break;

        case 'permission-denied':
        case 'firestore/permission-denied':
          this.authError =
            'Your account was created, but the profile could not be saved.';
          break;

        default:
          this.authError =
            'Unable to create your account. Please try again.';
      }

    } finally {
      this.registerLoading = false;
      this.refresh();
    }
  }

  // CUSTOMER NAVIGATION
  goToOrders(): void {
    if (this.isGuest) {
      this.goToLogin();
      return;
    }

    void this.router.navigate(['/home-cust/order']);
  }

  goToNotifications(): void {
    if (this.isGuest) {
      this.goToLogin();
      return;
    }

    if (this.changingPassword || this.loggingOut) return;

    this.closeSettings();

    void this.router.navigate(['/home-cust/notif-cust']);
  }

  // OPEN SETTINGS
  openSettings(): void {
    if (
      this.isGuest ||
      !this.uid ||
      this.changingPassword ||
      this.loggingOut
    ) return;

    this.showSettings = true;
    this.showPasswordForm = false;

    this.clearPasswordFields();
    this.refresh();
  }

  // CLOSE SETTINGS
  closeSettings(): void {
    if (
      this.changingPassword ||
      this.loggingOut
    ) return;

    this.showSettings = false;
    this.showPasswordForm = false;

    this.clearPasswordFields();
    this.refresh();
  }

  // TOGGLE CHANGE PASSWORD
  togglePasswordForm(): void {
    if (
      this.changingPassword ||
      this.loggingOut
    ) return;

    this.showPasswordForm = !this.showPasswordForm;
    this.clearPasswordFields();
    this.refresh();
  }

  // CLEAR PASSWORD DATA
  private clearPasswordFields(): void {
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmNewPassword = '';

    this.passwordError = '';

    this.showCurrentPassword = false;
    this.showNewPassword = false;
    this.showConfirmNewPassword = false;
  }

  // CHANGE PASSWORD THROUGH FIREBASE
  async changePassword(): Promise<void> {
    if (
      this.isGuest ||
      !this.showSettings ||
      !this.showPasswordForm ||
      this.changingPassword ||
      this.loggingOut
    ) return;

    const user = this.auth.currentUser;

    if (!user || user.uid !== this.uid || !user.email) {
      this.passwordError =
        'Please sign in again before changing your password.';
      return;
    }

    if (
      !user.providerData.some(
        provider => provider.providerId === 'password'
      )
    ) {
      this.passwordError =
        'This account does not have an email-and-password sign-in method.';
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
        'The new password must contain at least 8 characters.';
      return;
    }

    if (this.newPassword !== this.confirmNewPassword) {
      this.passwordError =
        'Your new passwords do not match.';
      return;
    }

    if (this.newPassword === this.currentPassword) {
      this.passwordError =
        'Choose a password different from your current one.';
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

      this.clearPasswordFields();

      this.showPasswordForm = false;
      this.showSettings = false;
      this.changingPassword = false;

      this.refresh();

      await Swal.fire({
        icon: 'success',
        title: 'Password Updated',
        text: 'Your SilkMart account password has been updated successfully.',
        confirmButtonColor: '#287156',
        heightAuto: false
      });

    } catch (error: any) {
      console.error('Password update error:', error);

      if (session !== this.sessionId) return;

      const code = String(error?.code || '');

      switch (code) {
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          this.passwordError =
            'Your current password is incorrect.';
          break;

        case 'auth/weak-password':
          this.passwordError =
            'Please choose a stronger password.';
          break;

        case 'auth/too-many-requests':
          this.passwordError =
            'Too many attempts. Please try again later.';
          break;

        case 'auth/requires-recent-login':
          this.passwordError =
            'Please sign in again before changing your password.';
          break;

        case 'auth/network-request-failed':
          this.passwordError =
            'Please check your internet connection.';
          break;

        default:
          this.passwordError =
            'Unable to update your password. Please try again.';
      }

      this.currentPassword = '';
      this.showCurrentPassword = false;

    } finally {
      if (session === this.sessionId) {
        this.changingPassword = false;
        this.refresh();
      }
    }
  }

  // LOGOUT WITH CONFIRMATION
  async logout(): Promise<void> {
    if (
      this.isGuest ||
      this.loggingOut ||
      this.changingPassword
    ) return;

    const wasSettingsOpen = this.showSettings;

    this.showSettings = false;
    this.refresh();

    const confirmation = await Swal.fire({
      icon: 'question',
      title: 'Log out of SilkMart?',
      text: 'You will be signed out of your customer account.',
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
    this.refresh();

    try {
      await this.authService.logout();

      sessionStorage.setItem(
        'silkmartGuestMode',
        'true'
      );

      this.setGuestMode();

      await this.router.navigate(['/login']);

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
      this.refresh();
    }
  }
}
