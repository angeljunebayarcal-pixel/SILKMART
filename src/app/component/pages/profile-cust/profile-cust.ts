import {
  CommonModule
} from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  OnInit
} from '@angular/core';

import {
  FormsModule
} from '@angular/forms';

import {
  Router
} from '@angular/router';

import {
  Auth,
  onAuthStateChanged
} from '@angular/fire/auth';

import {
  AuthServ
} from '../../../services/auth.serv';

import {
  UserServ
} from '../../../services/user.serv';


interface RecentOrder {

  id?: number;

  userId?: string;

  name: string;

  category?: string;

  price: number;

  quantity: number;

  total: number;

  status: string;

  orderDate: string;

}


@Component({
  selector: 'app-profile-cust',

  standalone: true,

  imports: [
    CommonModule,
    FormsModule
  ],

  templateUrl: './profile-cust.html',

  styleUrl: './profile-cust.scss',
})
export class ProfileCust implements OnInit {

  // =========================================
  // AUTH STATE
  // =========================================

  isGuest = true;

  authResolved = false;

  profileLoading = false;


  // =========================================
  // PROFILE DATA
  // =========================================

  uid = '';

  fullName = '';

  email = '';

  mobileNumber = '';

  completeAddress = '';

  role = 'customer';

  memberSince = '';


  // =========================================
  // EDIT VALUES
  // =========================================

  editMode = false;

  editFullName = '';

  editMobileNumber = '';

  editCompleteAddress = '';


  // =========================================
  // PAGE STATE
  // =========================================

  saving = false;

  successMessage = '';

  errorMessage = '';


  // =========================================
  // ORDERS
  // =========================================

  recentOrders: RecentOrder[] = [];


  // =========================================
  // AUTH POPUP
  // =========================================

  showAuthPopup = false;

  authMode:
    'login' | 'register' =
    'login';

  authLoading = false;

  authError = '';


  // =========================================
  // LOGIN POPUP VALUES
  // =========================================

  authEmail = '';

  authPassword = '';

  showAuthPassword = false;


  // =========================================
  // REGISTER POPUP VALUES
  // =========================================

  registerFullName = '';

  registerEmail = '';

  registerMobile = '';

  registerAddress = '';

  registerPassword = '';

  registerConfirmPassword = '';

  showRegisterPassword = false;

  showConfirmPassword = false;

  registerLoading = false;


  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private auth: Auth,
    private authService: AuthServ,
    private userService: UserServ,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}


  // =========================================
  // ON INIT
  // =========================================

  ngOnInit(): void {

    this.loadAuthenticatedUser();

  }


  // =========================================
  // PROFILE INITIAL
  // =========================================

  get profileInitial(): string {

    if (!this.fullName) {

      return 'C';

    }


    return this.fullName
      .trim()
      .charAt(0)
      .toUpperCase();

  }


  // =========================================
  // CLEAR PROFILE DATA
  // =========================================

  clearProfile(): void {

    this.uid = '';

    this.fullName = '';

    this.email = '';

    this.mobileNumber = '';

    this.completeAddress = '';

    this.role = 'customer';

    this.memberSince = '';


    this.recentOrders = [];


    this.editMode = false;

    this.editFullName = '';

    this.editMobileNumber = '';

    this.editCompleteAddress = '';


    this.successMessage = '';

    this.errorMessage = '';

  }


  // =========================================
  // SET GUEST MODE
  // =========================================

  setGuestMode(): void {

    this.isGuest = true;

    this.authResolved = true;

    this.profileLoading = false;


    this.clearProfile();


    this.cdr.detectChanges();

  }


  // =========================================
  // LOAD FIREBASE AUTH USER
  // =========================================

  loadAuthenticatedUser(): void {

    const guestMode =
      sessionStorage.getItem(
        'silkmartGuestMode'
      );


    if (guestMode === 'true') {

      this.setGuestMode();

      return;

    }


    onAuthStateChanged(
      this.auth,

      user => {

        if (!user) {

          this.setGuestMode();

          return;

        }


        this.isGuest = false;

        this.authResolved = true;


        this.uid =
          user.uid;


        this.email =
          user.email ?? '';


        this.cdr.detectChanges();


        this.loadRecentOrders();


        void this.loadProfile();

      }
    );

  }


  // =========================================
  // LOAD FIRESTORE PROFILE
  // =========================================

  async loadProfile(): Promise<void> {

    if (
      !this.uid ||
      this.isGuest
    ) {

      return;

    }


    try {

      this.profileLoading = true;

      this.errorMessage = '';


      this.cdr.detectChanges();


      const profile =
        await this.userService
          .getUserProfile(
            this.uid
          );


      if (
        this.isGuest ||
        !this.uid
      ) {

        return;

      }


      if (!profile) {

        this.errorMessage =
          'Profile information could not be found.';

        return;

      }


      this.fullName =
        profile.fullName ?? '';


      this.email =
        profile.email ||
        this.email;


      this.mobileNumber =
        profile.mobileNumber ?? '';


      this.completeAddress =
        profile.completeAddress ?? '';


      this.role =
        profile.role ||
        'customer';


      this.memberSince =
        this.formatCreatedDate(
          profile.createdAt
        );


    } catch (error) {

      console.error(
        'Profile load error:',
        error
      );


      if (!this.isGuest) {

        this.errorMessage =
          'Unable to load your profile.';

      }


    } finally {

      this.profileLoading = false;

      this.cdr.detectChanges();

    }

  }


  // =========================================
  // FORMAT FIRESTORE DATE
  // =========================================

  formatCreatedDate(
    value: any
  ): string {

    if (!value) {

      return 'Not available';

    }


    try {

      let date: Date;


      if (
        typeof value?.toDate ===
        'function'
      ) {

        date =
          value.toDate();

      } else {

        date =
          new Date(value);

      }


      return date.toLocaleDateString(
        'en-US',
        {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }
      );


    } catch {

      return 'Not available';

    }

  }


  // =========================================
  // EDIT PROFILE
  // =========================================

  enableEdit(): void {

    if (
      this.isGuest ||
      this.profileLoading
    ) {

      return;

    }


    this.editFullName =
      this.fullName;


    this.editMobileNumber =
      this.mobileNumber;


    this.editCompleteAddress =
      this.completeAddress;


    this.successMessage = '';

    this.errorMessage = '';

    this.editMode = true;

  }


  // =========================================
  // CANCEL EDIT
  // =========================================

  cancelEdit(): void {

    this.editMode = false;

    this.successMessage = '';

    this.errorMessage = '';

  }


  // =========================================
  // SAVE PROFILE
  // =========================================

  async saveProfile(): Promise<void> {

    if (
      this.isGuest ||
      !this.uid
    ) {

      return;

    }


    this.successMessage = '';

    this.errorMessage = '';


    if (
      !this.editFullName.trim()
    ) {

      this.errorMessage =
        'Full name is required.';

      return;

    }


    try {

      this.saving = true;


      await this.userService
        .updateUserProfile(
          this.uid,
          {

            fullName:
              this.editFullName.trim(),

            mobileNumber:
              this.editMobileNumber.trim(),

            completeAddress:
              this.editCompleteAddress.trim()

          }
        );


      this.fullName =
        this.editFullName.trim();


      this.mobileNumber =
        this.editMobileNumber.trim();


      this.completeAddress =
        this.editCompleteAddress.trim();


      this.editMode = false;


      this.successMessage =
        'Profile updated successfully.';


    } catch (error) {

      console.error(
        'Profile update error:',
        error
      );


      this.errorMessage =
        'Unable to update your profile.';


    } finally {

      this.saving = false;

      this.cdr.detectChanges();

    }

  }


  // =========================================
  // LOAD RECENT LOCAL ORDERS
  // =========================================

  loadRecentOrders(): void {

    // =====================================
    // GUEST / NO CURRENT USER
    // =====================================

    if (
      this.isGuest ||
      !this.uid
    ) {

      this.recentOrders = [];

      return;

    }


    // =====================================
    // READ SAVED ORDERS
    // =====================================

    const savedOrders =
      localStorage.getItem(
        'silkOrders'
      );


    if (!savedOrders) {

      this.recentOrders = [];

      return;

    }


    try {

      const parsed:
        RecentOrder[] =
        JSON.parse(
          savedOrders
        );


      if (!Array.isArray(parsed)) {

        this.recentOrders = [];

        return;

      }


      // =====================================
      // CURRENT CUSTOMER ORDERS ONLY
      // =====================================

      const customerOrders =
        parsed.filter(
          order =>
            order.userId ===
            this.uid
        );


      // =====================================
      // SHOW ONLY THE LATEST 1 ORDER
      // =====================================

      this.recentOrders =
        customerOrders
          .slice()
          .reverse()
          .slice(0, 1);


      this.cdr.detectChanges();


    } catch {

      this.recentOrders = [];

    }

  }


  // =========================================
  // OPEN SIGN IN POPUP
  // =========================================

  goToLogin(): void {

    this.authMode = 'login';

    this.authError = '';

    this.showAuthPopup = true;

  }


  // =========================================
  // OPEN CREATE ACCOUNT POPUP
  // =========================================

  goToCreateAccount(): void {

    this.authMode = 'register';

    this.authError = '';

    this.showAuthPopup = true;

  }


  // =========================================
  // CLOSE AUTH POPUP
  // =========================================

  closeAuthPopup(): void {

    if (
      this.authLoading ||
      this.registerLoading
    ) {

      return;

    }


    this.showAuthPopup = false;

    this.authError = '';

    this.showAuthPassword = false;

    this.showRegisterPassword = false;

    this.showConfirmPassword = false;

  }


  // =========================================
  // SWITCH TO LOGIN
  // =========================================

  showLoginMode(): void {

    if (this.registerLoading) {

      return;

    }


    this.authMode = 'login';

    this.authError = '';

  }


  // =========================================
  // SWITCH TO REGISTER
  // =========================================

  showRegisterMode(): void {

    if (this.authLoading) {

      return;

    }


    this.authMode = 'register';

    this.authError = '';

  }


  // =========================================
  // TOGGLE LOGIN PASSWORD
  // =========================================

  toggleAuthPassword(): void {

    this.showAuthPassword =
      !this.showAuthPassword;

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
  // LOGIN FROM PROFILE POPUP
  // =========================================

  async signInFromProfile():
    Promise<void> {

    this.authError = '';


    if (
      !this.authEmail.trim() ||
      !this.authPassword
    ) {

      this.authError =
        'Please enter your email and password.';

      return;

    }


    try {

      this.authLoading = true;


      const result =
        await this.authService.login(
          this.authEmail.trim(),
          this.authPassword
        );


      sessionStorage.removeItem(
        'silkmartGuestMode'
      );


      this.isGuest = false;

      this.authResolved = true;


      this.uid =
        result.user.uid;


      this.email =
        result.user.email ?? '';


      this.showAuthPopup = false;


      this.authEmail = '';

      this.authPassword = '';

      this.showAuthPassword = false;

      this.authError = '';


      this.cdr.detectChanges();


      this.loadRecentOrders();


      await this.loadProfile();


    } catch (error: any) {

      console.error(
        'Profile login error:',
        error
      );


      switch (error?.code) {

        case 'auth/invalid-email':

          this.authError =
            'Please enter a valid email address.';

          break;


        case 'auth/invalid-credential':

          this.authError =
            'Incorrect email or password.';

          break;


        case 'auth/user-disabled':

          this.authError =
            'This account has been disabled.';

          break;


        case 'auth/too-many-requests':

          this.authError =
            'Too many attempts. Please try again later.';

          break;


        case 'auth/network-request-failed':

          this.authError =
            'Please check your internet connection.';

          break;


        default:

          this.authError =
            'Unable to sign in. Please try again.';

          break;

      }


    } finally {

      this.authLoading = false;

      this.cdr.detectChanges();

    }

  }


  // =========================================
  // CREATE ACCOUNT FROM PROFILE POPUP
  // =========================================

  async createAccountFromProfile():
    Promise<void> {

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


    if (
      this.registerPassword.length < 6
    ) {

      this.authError =
        'Password must contain at least 6 characters.';

      return;

    }


    try {

      this.registerLoading = true;


      const result =
        await this.authService.register(
          this.registerEmail
            .trim()
            .toLowerCase(),

          this.registerPassword
        );


      await this.userService
        .createUserProfile(
          result.user.uid,
          {

            fullName:
              this.registerFullName.trim(),

            email:
              this.registerEmail
                .trim()
                .toLowerCase(),

            mobileNumber:
              this.registerMobile.trim(),

            completeAddress:
              this.registerAddress.trim(),

            role:
              'customer'

          }
        );


      sessionStorage.removeItem(
        'silkmartGuestMode'
      );


      this.isGuest = false;

      this.authResolved = true;


      this.uid =
        result.user.uid;


      this.email =
        result.user.email ?? '';


      this.showAuthPopup = false;


      this.registerFullName = '';

      this.registerEmail = '';

      this.registerMobile = '';

      this.registerAddress = '';

      this.registerPassword = '';

      this.registerConfirmPassword = '';

      this.showRegisterPassword = false;

      this.showConfirmPassword = false;

      this.authError = '';


      this.cdr.detectChanges();


      this.loadRecentOrders();


      await this.loadProfile();


    } catch (error: any) {

      console.error(
        'Profile registration error:',
        error
      );


      switch (error?.code) {

        case 'auth/email-already-in-use':

          this.authError =
            'This email address already has a SilkMart account.';

          break;


        case 'auth/invalid-email':

          this.authError =
            'Please enter a valid email address.';

          break;


        case 'auth/weak-password':

          this.authError =
            'Please use a stronger password.';

          break;


        case 'auth/network-request-failed':

          this.authError =
            'Please check your internet connection.';

          break;


        case 'permission-denied':

        case 'firestore/permission-denied':

          this.authError =
            'The account was created, but the profile could not be saved.';

          break;


        default:

          this.authError =
            'Unable to create your account. Please try again.';

          break;

      }


    } finally {

      this.registerLoading = false;

      this.cdr.detectChanges();

    }

  }


  // =========================================
  // ORDERS
  // =========================================

  goToOrders(): void {

    if (this.isGuest) {

      this.goToLogin();

      return;

    }


    this.router.navigate([
      '/home-cust/order'
    ]);

  }


  // =========================================
  // LOGOUT
  // =========================================

  async logout(): Promise<void> {

    try {

      await this.authService.logout();


      sessionStorage.setItem(
        'silkmartGuestMode',
        'true'
      );


      this.setGuestMode();


      await this.router.navigate([
        '/login'
      ]);


    } catch (error) {

      console.error(
        'Logout error:',
        error
      );

    }

  }

}