
import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

import { AuthServ } from '../../../services/auth.serv';
import { UserServ } from '../../../services/user.serv';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class Login {

  // =========================================
  // FRAME STATE
  // =========================================

  showLoginForm = false;
  showRegisterForm = false;

  // =========================================
  // PASSWORD VISIBILITY
  // =========================================

  showPassword = false;
  showRegisterPassword = false;
  showConfirmPassword = false;

  // =========================================
  // LOGIN
  // =========================================

  email = '';
  password = '';
  loginLoading = false;

  // =========================================
  // REGISTRATION
  // =========================================

  fullName = '';
  registerEmail = '';
  mobileNumber = '';
  completeAddress = '';
  registerPassword = '';
  confirmPassword = '';
  registerLoading = false;

  selectedAccountType: 'customer' | 'staff' = 'customer';

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private router: Router,
    private authService: AuthServ,
    private userService: UserServ
  ) {}

  // =========================================
  // OPEN LOGIN
  // =========================================

  openLogin(): void {
    this.showLoginForm = true;
    this.showRegisterForm = false;
    this.showPassword = false;
  }

  // =========================================
  // CLOSE LOGIN
  // =========================================

  closeLogin(): void {
    if (this.loginLoading || this.registerLoading) {
      return;
    }

    this.showLoginForm = false;
    this.showRegisterForm = false;

    this.showPassword = false;
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  // =========================================
  // OPEN REGISTER
  // =========================================

  openRegister(): void {
    this.showLoginForm = true;
    this.showRegisterForm = true;

    this.selectedAccountType = 'customer';

    this.showPassword = false;
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  // =========================================
  // BACK TO LOGIN
  // =========================================

  backToLogin(): void {
    if (this.registerLoading) {
      return;
    }

    this.showRegisterForm = false;
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  // =========================================
  // PASSWORD TOGGLES
  // =========================================

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  toggleRegisterPassword(): void {
    this.showRegisterPassword = !this.showRegisterPassword;
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // =========================================
  // CONTINUE AS CUSTOMER
  // =========================================

  async continueAsCustomer(): Promise<void> {
    try {
      if (this.authService.currentUser) {
        await this.authService.logout();
      }

      sessionStorage.setItem(
        'silkmartGuestMode',
        'true'
      );

      this.showLoginForm = false;
      this.showRegisterForm = false;
      this.showPassword = false;
      this.showRegisterPassword = false;
      this.showConfirmPassword = false;

      await this.router.navigate(['/home-cust']);

    } catch (error) {
      console.error('Guest access error:', error);

      sessionStorage.setItem(
        'silkmartGuestMode',
        'true'
      );

      await this.router.navigate(['/home-cust']);
    }
  }

  // =========================================
  // ESCAPE KEY
  // =========================================

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (
      this.showLoginForm &&
      !this.loginLoading &&
      !this.registerLoading
    ) {
      this.closeLogin();
    }
  }

  // =========================================
  // FIREBASE LOGIN
  // =========================================

  async login(form: NgForm): Promise<void> {

    if (this.loginLoading) {
      return;
    }

    if (form.invalid) {
      form.control.markAllAsTouched();

      await Swal.fire({
        icon: 'warning',
        title: 'Incomplete Information',
        text: 'Please enter your email and password.',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });

      return;
    }

    this.loginLoading = true;

    let destination = '';

    try {
      // Sign in using Firebase Authentication.
      await this.authService.login(
        this.email.trim(),
        this.password
      );

      const signedInUser = this.authService.currentUser;

      if (!signedInUser) {
        throw new Error(
          'Unable to verify signed-in user.'
        );
      }

      // Read the account's actual Firebase role.
      destination = await this.getAccountDestination(
        signedInUser.uid
      );

      sessionStorage.removeItem(
        'silkmartGuestMode'
      );

    } catch (error: any) {
      console.error('Login verification error:', error);

      let title = 'Sign In Failed';
      let message = 'Unable to sign in. Please try again.';
      let icon: 'error' | 'info' = 'error';

      if (
        error?.code === 'auth/invalid-credential' ||
        error?.code === 'auth/wrong-password' ||
        error?.code === 'auth/user-not-found'
      ) {
        message = 'Incorrect email or password.';
      } else if (error?.code === 'auth/invalid-email') {
        message = 'Please enter a valid email address.';
      } else if (error?.code === 'auth/user-disabled') {
        message = 'This account has been disabled.';
      } else if (error?.code === 'auth/too-many-requests') {
        message =
          'Too many sign-in attempts. Please try again later.';
      } else if (error?.code === 'auth/network-request-failed') {
        message = 'Please check your internet connection.';
      } else if (error?.message === 'STAFF_ACCOUNT_NOT_APPROVED') {
        title = 'Admin / Staff Account';
        icon = 'info';

        message =
          'Your account exists, but its Admin / Staff ' +
          'role has not been approved yet.';
      } else if (
        error?.message === 'Unable to verify account role.' ||
        error?.message === 'Unable to verify signed-in user.'
      ) {
        message =
          'Your sign-in could not be completed because ' +
          'your account information could not be verified.';
      } else if (
        error?.message === 'Your account role is not authorized.'
      ) {
        message =
          'Your account does not have a recognized role.';
      }

      this.loginLoading = false;

      await Swal.fire({
        icon,
        title,
        text: message,
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });

      return;

    } finally {
      // Do not leave the sign-in button spinning.
      this.loginLoading = false;
    }

    // =========================================
    // SUCCESSFUL LOGIN
    // =========================================

    await Swal.fire({
      icon: 'success',
      title: 'Welcome Back!',
      text: 'You have successfully signed in to SilkMart.',
      confirmButtonText: 'Continue',
      confirmButtonColor: '#245d43',
      timer: 1800,
      timerProgressBar: true
    });

    this.closeLogin();

    // =========================================
    // DASHBOARD NAVIGATION
    // =========================================

    try {
      const success = await this.router.navigate([
        destination
      ]);

      if (!success) {
        throw new Error(
          'Dashboard navigation was cancelled.'
        );
      }

    } catch (error) {
      console.error('Navigation error:', error);

      await Swal.fire({
        icon: 'error',
        title: 'Dashboard Unavailable',
        text:
          'Your account was signed in successfully, ' +
          'but the dashboard could not be opened. ' +
          'Please check the route configuration.',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });
    }
  }

  // =========================================
  // CREATE FIREBASE ACCOUNT
  // =========================================

  async createAccount(form: NgForm): Promise<void> {

    if (this.registerLoading) {
      return;
    }

    if (form.invalid) {
      form.control.markAllAsTouched();

      await Swal.fire({
        icon: 'warning',
        title: 'Incomplete Information',
        text: 'Please complete all required fields.',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });

      return;
    }

    if (this.registerPassword !== this.confirmPassword) {
      await Swal.fire({
        icon: 'warning',
        title: 'Passwords Do Not Match',
        text: 'Please make sure both passwords are the same.',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });

      return;
    }

    if (this.registerPassword.length < 6) {
      await Swal.fire({
        icon: 'warning',
        title: 'Password Too Short',
        text: 'Your password must contain at least 6 characters.',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });

      return;
    }

    this.registerLoading = true;

    const accountType = this.selectedAccountType;

    try {
      // =====================================
      // CREATE FIREBASE AUTH ACCOUNT
      // =====================================

      const result = await this.authService.register(
        this.registerEmail.trim().toLowerCase(),
        this.registerPassword
      );

      // =====================================
      // CREATE FIRESTORE PROFILE
      // =====================================

      // Staff applications are recorded
      // separately from Customer accounts.
      // Only trusted authorization can grant
      // the actual admin or staff role.

      const accountRole =
        accountType === 'staff'
          ? 'pending_staff'
          : 'customer';

      const profileData = {
        fullName: this.fullName.trim(),
        email: this.registerEmail.trim().toLowerCase(),
        mobileNumber: this.mobileNumber.trim(),
        completeAddress: this.completeAddress.trim(),
        role: accountRole,

        ...(accountType === 'staff'
          ? {
              requestedRole: 'staff',
              approvalStatus: 'pending'
            }
          : {})
      };

      await this.userService.createUserProfile(
        result.user.uid,
        profileData as Parameters<
          UserServ['createUserProfile']
        >[1]
      );

      sessionStorage.removeItem(
        'silkmartGuestMode'
      );

      // =====================================
      // ADMIN / STAFF REGISTRATION
      // =====================================

      if (accountType === 'staff') {

        await Swal.fire({
          icon: 'success',
          title: 'Account Created!',
          text:
            'Your Admin / Staff registration was successful. ' +
            'Your account needs authorization before ' +
            'opening the administrator dashboard.',
          confirmButtonText: 'Continue',
          confirmButtonColor: '#245d43'
        });

        this.clearRegisterForm();

        this.showRegisterForm = false;
        this.showLoginForm = false;

        await this.router.navigate(['/login']);
        this.openLogin();

        return;
      }

      // =====================================
      // CUSTOMER REGISTRATION
      // =====================================

      await Swal.fire({
        icon: 'success',
        title: 'Account Created!',
        text:
          'Your SilkMart customer account ' +
          'has been created successfully.',
        confirmButtonText: 'Continue',
        confirmButtonColor: '#245d43',
        timer: 2200,
        timerProgressBar: true
      });

      this.clearRegisterForm();

      this.showRegisterForm = false;
      this.showLoginForm = false;

      await this.router.navigate(['/home-cust']);

    } catch (error: any) {
      console.error('Registration error:', error);

      let message =
        'Unable to complete registration. Please try again.';

      if (error?.code === 'auth/email-already-in-use') {
        message =
          'This email is already registered. Please sign in ' +
          'instead of creating another account.';
      } else if (error?.code === 'auth/invalid-email') {
        message = 'Please enter a valid email address.';
      } else if (error?.code === 'auth/weak-password') {
        message = 'Please use a stronger password.';
      } else if (
        error?.code === 'permission-denied' ||
        error?.code === 'firestore/permission-denied'
      ) {
        message =
          'Firebase Authentication may have created the account, ' +
          'but Firestore did not save its profile. ' +
          'Please check your Firestore rules.';
      }

      await Swal.fire({
        icon: 'error',
        title: 'Account Creation Failed',
        text: message,
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });

    } finally {
      // Always reset registration loading.
      this.registerLoading = false;
    }
  }

  // =========================================
  // CLEAR REGISTRATION FORM
  // =========================================

  clearRegisterForm(): void {
    this.fullName = '';
    this.registerEmail = '';
    this.mobileNumber = '';
    this.completeAddress = '';
    this.registerPassword = '';
    this.confirmPassword = '';

    this.selectedAccountType = 'customer';

    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  // =========================================
  // ROLE-BASED REDIRECT
  // =========================================

  private getAccountDestination(
    uid: string
  ): Promise<string> {

    return new Promise((resolve, reject) => {
      let finished = false;
      let unsubscribe: (() => void) | null = null;

      const timeout = setTimeout(() => {
        if (finished) {
          return;
        }

        finished = true;
        unsubscribe?.();

        reject(
          new Error('Unable to verify account role.')
        );
      }, 10000);

      try {
        unsubscribe = this.userService.listenToUserProfile(
          uid,
          profile => {
            if (finished) {
              return;
            }

            finished = true;
            clearTimeout(timeout);

            queueMicrotask(() => {
              unsubscribe?.();
            });

            const role = String(
              profile?.role ?? ''
            ).trim().toLowerCase();

            // ADMIN / STAFF
            if (
              role === 'admin' ||
              role === 'administrator' ||
              role === 'staff'
            ) {
              resolve('/home-adm');
              return;
            }

            // CUSTOMER
            if (role === 'customer') {
              resolve('/home-cust');
              return;
            }

            // PENDING STAFF
            if (role === 'pending_staff') {
              reject(
                new Error('STAFF_ACCOUNT_NOT_APPROVED')
              );
              return;
            }

            reject(
              new Error(
                'Your account role is not authorized.'
              )
            );
          }
        );

      } catch (error) {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  }
}
