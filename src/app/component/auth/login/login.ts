import {
  CommonModule
} from '@angular/common';

import {
  Component,
  HostListener
} from '@angular/core';

import {
  FormsModule,
  NgForm
} from '@angular/forms';

import {
  Router
} from '@angular/router';

import Swal from 'sweetalert2';

import {
  AuthServ
} from '../../../services/auth.serv';

import {
  UserServ
} from '../../../services/user.serv';


@Component({
  selector: 'app-login',

  standalone: true,

  imports: [
    CommonModule,
    FormsModule
  ],

  templateUrl: './login.html',

  styleUrls: [
    './login.scss'
  ],
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
  // REGISTER
  // =========================================

  fullName = '';

  registerEmail = '';

  mobileNumber = '';

  completeAddress = '';

  registerPassword = '';

  confirmPassword = '';

  registerLoading = false;


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
  // CLOSE
  // =========================================

  closeLogin(): void {

    if (
      this.loginLoading ||
      this.registerLoading
    ) {

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
  // TOGGLE LOGIN PASSWORD
  // =========================================

  togglePassword(): void {

    this.showPassword =
      !this.showPassword;

  }


  // =========================================
  // TOGGLE REGISTER PASSWORD
  // =========================================

  toggleRegisterPassword(): void {

    this.showRegisterPassword =
      !this.showRegisterPassword;

  }


  // =========================================
  // TOGGLE CONFIRM PASSWORD
  // =========================================

  toggleConfirmPassword(): void {

    this.showConfirmPassword =
      !this.showConfirmPassword;

  }


  // =========================================
  // CONTINUE AS CUSTOMER
  // =========================================

  async continueAsCustomer(): Promise<void> {

    try {

      // =====================================
      // IMPORTANT
      // =====================================
      // Guest mode must NOT keep the previous
      // Firebase account signed in.

      if (this.authService.currentUser) {

        await this.authService.logout();

      }


      // =====================================
      // MARK THIS SESSION AS GUEST
      // =====================================

      sessionStorage.setItem(
        'silkmartGuestMode',
        'true'
      );


      this.showLoginForm = false;

      this.showRegisterForm = false;

      this.showPassword = false;

      this.showRegisterPassword = false;

      this.showConfirmPassword = false;


      // =====================================
      // GO TO CUSTOMER HOME
      // =====================================

      await this.router.navigate([
        '/home-cust'
      ]);


    } catch (error) {

      console.error(
        'Continue as customer error:',
        error
      );


      // Still force guest mode even if an
      // unexpected logout problem occurs.

      sessionStorage.setItem(
        'silkmartGuestMode',
        'true'
      );


      await this.router.navigate([
        '/home-cust'
      ]);

    }

  }


  // =========================================
  // ESCAPE
  // =========================================

  @HostListener(
    'document:keydown.escape'
  )
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

  async login(
    form: NgForm
  ): Promise<void> {

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


    try {

      this.loginLoading = true;


      // =====================================
      // FIREBASE LOGIN
      // =====================================

      await this.authService.login(
        this.email.trim(),
        this.password
      );


      // =====================================
      // USER IS NO LONGER A GUEST
      // =====================================

      sessionStorage.removeItem(
        'silkmartGuestMode'
      );


      this.loginLoading = false;


      // =====================================
      // SUCCESS
      // =====================================

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


      await this.router.navigate([
        '/home-cust'
      ]);


    } catch (error: any) {

      this.loginLoading = false;


      console.error(
        'Login error:',
        error
      );


      let message =
        'Unable to sign in. Please check your email and password.';


      if (
        error?.code ===
        'auth/invalid-email'
      ) {

        message =
          'Please enter a valid email address.';

      }


      if (
        error?.code ===
        'auth/invalid-credential'
      ) {

        message =
          'Incorrect email or password.';

      }


      if (
        error?.code ===
        'auth/user-disabled'
      ) {

        message =
          'This account has been disabled.';

      }


      if (
        error?.code ===
        'auth/too-many-requests'
      ) {

        message =
          'Too many attempts. Please wait and try again.';

      }


      if (
        error?.code ===
        'auth/network-request-failed'
      ) {

        message =
          'Please check your internet connection.';

      }


      await Swal.fire({
        icon: 'error',
        title: 'Sign In Failed',
        text: message,
        confirmButtonText: 'Try Again',
        confirmButtonColor: '#245d43'
      });

    }

  }


  // =========================================
  // CREATE FIREBASE ACCOUNT
  // =========================================

  async createAccount(
    form: NgForm
  ): Promise<void> {

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


    // =====================================
    // PASSWORD MATCH
    // =====================================

    if (
      this.registerPassword !==
      this.confirmPassword
    ) {

      await Swal.fire({
        icon: 'warning',
        title: 'Passwords Do Not Match',
        text: 'Please make sure both passwords are the same.',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });


      return;

    }


    // =====================================
    // PASSWORD LENGTH
    // =====================================

    if (
      this.registerPassword.length < 6
    ) {

      await Swal.fire({
        icon: 'warning',
        title: 'Password Too Short',
        text: 'Your password must contain at least 6 characters.',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });


      return;

    }


    try {

      this.registerLoading = true;


      // =====================================
      // FIREBASE AUTHENTICATION
      // =====================================

      const result =
        await this.authService.register(
          this.registerEmail
            .trim()
            .toLowerCase(),

          this.registerPassword
        );


      // =====================================
      // FIRESTORE PROFILE
      // =====================================

      await this.userService
        .createUserProfile(
          result.user.uid,
          {
            fullName:
              this.fullName.trim(),

            email:
              this.registerEmail
                .trim()
                .toLowerCase(),

            mobileNumber:
              this.mobileNumber.trim(),

            completeAddress:
              this.completeAddress.trim(),

            role:
              'customer'
          }
        );


      // =====================================
      // ACCOUNT NOW SIGNED IN
      // =====================================

      sessionStorage.removeItem(
        'silkmartGuestMode'
      );


      this.registerLoading = false;


      // =====================================
      // SUCCESS
      // =====================================

      await Swal.fire({
        icon: 'success',
        title: 'Account Created!',
        text: 'Your SilkMart account has been created successfully.',
        confirmButtonText: 'Continue',
        confirmButtonColor: '#245d43',
        timer: 2200,
        timerProgressBar: true
      });


      this.clearRegisterForm();


      this.showRegisterForm = false;

      this.showLoginForm = false;


      // Firebase automatically signs in the
      // newly created account.

      await this.router.navigate([
        '/home-cust'
      ]);


    } catch (error: any) {

      this.registerLoading = false;


      console.error(
        'Create account error:',
        error
      );


      let message =
        'Unable to create your account. Please try again.';


      if (
        error?.code ===
        'auth/email-already-in-use'
      ) {

        message =
          'This email address already has a SilkMart account.';

      }


      if (
        error?.code ===
        'auth/invalid-email'
      ) {

        message =
          'Please enter a valid email address.';

      }


      if (
        error?.code ===
        'auth/weak-password'
      ) {

        message =
          'Please use a stronger password.';

      }


      if (
        error?.code ===
        'auth/network-request-failed'
      ) {

        message =
          'Please check your internet connection.';

      }


      if (
        error?.code ===
        'permission-denied' ||
        error?.code ===
        'firestore/permission-denied'
      ) {

        message =
          'The account was created, but the profile could not be saved. Please check your Firestore rules.';

      }


      await Swal.fire({
        icon: 'error',
        title: 'Account Creation Failed',
        text: message,
        confirmButtonText: 'Okay',
        confirmButtonColor: '#245d43'
      });

    }

  }


  // =========================================
  // CLEAR REGISTER FORM
  // =========================================

  clearRegisterForm(): void {

    this.fullName = '';

    this.registerEmail = '';

    this.mobileNumber = '';

    this.completeAddress = '';

    this.registerPassword = '';

    this.confirmPassword = '';

    this.showRegisterPassword = false;

    this.showConfirmPassword = false;

  }

}