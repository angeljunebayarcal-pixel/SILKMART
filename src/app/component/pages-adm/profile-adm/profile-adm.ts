
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
  onAuthStateChanged,
  signOut
} from '@angular/fire/auth';

import {
  Firestore,
  doc,
  getDoc,
  updateDoc
} from '@angular/fire/firestore';

import Swal from 'sweetalert2';

interface StaffProfile {
  fullName?: string;
  email?: string;
  mobileNumber?: string;
  completeAddress?: string;
  role?: string;
  createdAt?: any;
  updatedAt?: any;
  isActive?: boolean;
}

@Component({
  selector: 'app-profile-adm',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule
  ],
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

  successMessage = '';
  errorMessage = '';

  private unsubscribeAuth: (() => void) | null = null;
  private sessionId = 0;

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private router: Router,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  private inContext<T>(callback: () => T): T {
    return runInInjectionContext(
      this.injector,
      callback
    );
  }

  private refresh(): void {
    this.cdr.detectChanges();
  }

  ngOnInit(): void {
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

          this.refresh();
          void this.loadProfile(session);
        }),
        error => this.zone.run(() => {
          this.authResolved = true;
          this.errorMessage =
            'Unable to verify your account.';
          console.error(error);
          this.refresh();
        })
      )
    );
  }

  ngOnDestroy(): void {
    this.sessionId++;
    this.unsubscribeAuth?.();
  }

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
    this.profileLoading = false;
    this.editMode = false;
    this.saving = false;

    this.successMessage = '';
    this.errorMessage = '';
  }

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

  // -----------------------------------------
  // LOAD PROFILE FROM FIRESTORE
  // -----------------------------------------

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

        this.memberSince = this.formatDate(
          profile.createdAt
        );

        this.lastUpdated = this.formatDate(
          profile.updatedAt
        );

        this.refresh();
      });

    } catch (error: any) {
      console.error('Admin profile load error:', error);

      this.zone.run(() => {
        if (session !== this.sessionId) return;

        this.errorMessage =
          error?.code === 'permission-denied'
            ? 'Firebase denied access to your profile. Check your account permissions.'
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

  // -----------------------------------------
  // EDIT PERSONAL INFORMATION
  // -----------------------------------------

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
    if (
      !this.uid ||
      !this.isAuthorized ||
      this.saving
    ) return;

    const fullName = this.editFullName.trim();
    const mobileNumber = this.editMobileNumber.trim();
    const completeAddress =
      this.editCompleteAddress.trim();

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
      this.errorMessage =
        'Mobile number is too long.';
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

    const userId = this.uid;
    const session = this.sessionId;

    this.saving = true;
    this.refresh();

    try {
      // Only personal details are updated.
      // Role, email, and createdAt remain unchanged.
      await this.inContext(() =>
        updateDoc(
          doc(this.firestore, 'users', userId),
          {
            fullName,
            mobileNumber,
            completeAddress
          }
        )
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
      console.error('Admin profile update error:', error);

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

  // -----------------------------------------
  // DATE DISPLAY
  // -----------------------------------------

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

  // -----------------------------------------
  // STAFF NAVIGATION
  // -----------------------------------------

  goToInventory(): void {
    if (!this.isAuthorized) return;

    this.router.navigate([
      '/home-adm/inventory'
    ]);
  }

  goToProducts(): void {
    if (!this.isAuthorized) return;

    this.router.navigate([
      '/home-adm/products'
    ]);
  }

  goToCustomerOrders(): void {
    if (!this.isAuthorized) return;

    this.router.navigate([
      '/home-adm/cust-order'
    ]);
  }

  // -----------------------------------------
  // LOGOUT
  // -----------------------------------------

  async logout(): Promise<void> {
    if (this.loggingOut) return;

    const confirmation = await Swal.fire({
      icon: 'question',
      title: 'Log out of SilkMart?',
      text: 'You will be signed out of your staff account.',
      showCancelButton: true,
      confirmButtonText: 'Log Out',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#287156',
      reverseButtons: true
    });

    if (!confirmation.isConfirmed) return;

    this.loggingOut = true;

    try {
      await this.inContext(() =>
        signOut(this.auth)
      );

      sessionStorage.removeItem('silkmartGuestMode');

      await this.router.navigateByUrl('/');

    } catch (error) {
      console.error('Logout error:', error);

      await Swal.fire({
        icon: 'error',
        title: 'Logout Failed',
        text: 'Unable to sign out. Please try again.',
        confirmButtonColor: '#287156'
      });

    } finally {
      this.loggingOut = false;
    }
  }
}
