
import { CommonModule } from '@angular/common';
import {
  Component,
  HostListener,
  Injector,
  OnDestroy,
  runInInjectionContext
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

import {
  Auth,
  deleteUser,
  signOut
} from '@angular/fire/auth';

import {
  Firestore,
  doc,
  writeBatch,
  serverTimestamp
} from '@angular/fire/firestore';

import { AuthServ } from '../../../services/auth.serv';
import { UserServ } from '../../../services/user.serv';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class Login implements OnDestroy {

  showLoginForm = false;
  showRegisterForm = false;

  showPassword = false;
  showRegisterPassword = false;
  showConfirmPassword = false;

  email = '';
  password = '';
  loginLoading = false;

  fullName = '';
  registerEmail = '';
  mobileNumber = '';
  completeAddress = '';
  registerPassword = '';
  confirmPassword = '';
  registerLoading = false;

  selectedAccountType: 'customer' | 'staff' = 'customer';

  staffIdFile: File | null = null;
  staffIdPreviewUrl = '';
  staffIdError = '';

  private readonly maxJpgBytes = 350 * 1024;

  constructor(
    private router: Router,
    private authService: AuthServ,
    private userService: UserServ,
    private auth: Auth,
    private firestore: Firestore,
    private injector: Injector
  ) {}

  ngOnDestroy(): void {
    this.resetStaffId();
  }

  openLogin(): void {
    this.showLoginForm = true;
    this.showRegisterForm = false;
    this.showPassword = false;
  }

  closeLogin(): void {
    if (this.loginLoading || this.registerLoading) return;

    this.showLoginForm = false;
    this.showRegisterForm = false;
    this.showPassword = false;
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  openRegister(): void {
    this.showLoginForm = true;
    this.showRegisterForm = true;
    this.selectedAccountType = 'customer';
    this.resetStaffId();

    this.showPassword = false;
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  backToLogin(): void {
    if (this.registerLoading) return;

    this.showRegisterForm = false;
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  toggleRegisterPassword(): void {
    this.showRegisterPassword = !this.showRegisterPassword;
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  async continueAsCustomer(): Promise<void> {
    try {
      if (this.auth.currentUser) {
        await runInInjectionContext(
          this.injector,
          () => signOut(this.auth)
        );
      }
    } catch (error) {
      console.error('Guest logout failed:', error);
    }

    sessionStorage.setItem('silkmartGuestMode', 'true');

    this.closeLogin();
    await this.router.navigate(['/home-cust']);
  }

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

  // ========================================
  // VERIFICATION JPG SELECTION
  // ========================================

  onStaffIdSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;

    this.resetStaffId();

    if (!file) return;

    const name = file.name.toLowerCase();

    if (
      file.type !== 'image/jpeg' ||
      !(name.endsWith('.jpg') || name.endsWith('.jpeg'))
    ) {
      this.staffIdError = 'Choose a JPG or JPEG image.';
      input.value = '';
      return;
    }

    if (file.size === 0 || file.size > 15 * 1024 * 1024) {
      this.staffIdError =
        'Choose a valid JPG image smaller than 15 MB.';
      input.value = '';
      return;
    }

    this.staffIdFile = file;
    this.staffIdPreviewUrl = URL.createObjectURL(file);
  }

  private resetStaffId(): void {
    if (this.staffIdPreviewUrl) {
      URL.revokeObjectURL(this.staffIdPreviewUrl);
    }

    this.staffIdFile = null;
    this.staffIdPreviewUrl = '';
    this.staffIdError = '';
  }

  clearStaffId(input: HTMLInputElement): void {
    this.resetStaffId();
    input.value = '';
  }

  // ========================================
  // AUTOMATIC JPG COMPRESSION
  // ========================================

  private async compressStaffId(file: File): Promise<{
    base64: string;
    size: number;
  }> {
    const originalUrl = URL.createObjectURL(file);

    try {
      const image = new Image();

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error('INVALID_VERIFICATION_IMAGE'));

        image.src = originalUrl;
      });

      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 50000000
      ) {
        throw new Error('INVALID_VERIFICATION_IMAGE');
      }

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('IMAGE_PROCESSING_FAILED');
      }

      for (const maxDimension of [1600, 1400, 1200, 1000, 800, 640]) {
        const ratio = Math.min(
          1,
          maxDimension /
            Math.max(image.naturalWidth, image.naturalHeight)
        );

        canvas.width = Math.max(
          1,
          Math.round(image.naturalWidth * ratio)
        );
        canvas.height = Math.max(
          1,
          Math.round(image.naturalHeight * ratio)
        );

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          image,
          0,
          0,
          canvas.width,
          canvas.height
        );

        for (const quality of [0.85, 0.75, 0.65, 0.5, 0.4]) {
          const base64 = canvas.toDataURL(
            'image/jpeg',
            quality
          );

          const encoded = base64.split(',')[1] || '';
          const size = Math.floor(encoded.length * 3 / 4);

          if (
            size > 0 &&
            size <= this.maxJpgBytes &&
            base64.length < 500000
          ) {
            return { base64, size };
          }
        }
      }

      throw new Error('IMAGE_TOO_LARGE');
    } finally {
      URL.revokeObjectURL(originalUrl);
    }
  }

  // ========================================
  // FIRESTORE BATCH FOR STAFF REGISTRATION
  // ========================================

  private async createStaffApplication(
    uid: string,
    file: File
  ): Promise<void> {
    const image = await this.compressStaffId(file);

    const userRef = runInInjectionContext(
      this.injector,
      () => doc(this.firestore, 'users', uid)
    );

    const verificationRef = runInInjectionContext(
      this.injector,
      () => doc(this.firestore, 'staff_verifications', uid)
    );

    const batch = runInInjectionContext(
      this.injector,
      () => writeBatch(this.firestore)
    );

    batch.set(userRef, {
      fullName: this.fullName.trim(),
      email: this.registerEmail.trim().toLowerCase(),
      mobileNumber: this.mobileNumber.trim(),
      completeAddress: this.completeAddress.trim(),
      role: 'pending_staff',
      requestedRole: 'staff',
      approvalStatus: 'pending',
      verificationStorage: 'firestore-base64',
      verificationImagePath: `staff_verifications/${uid}`,
      staffAppliedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });

    batch.set(verificationRef, {
      applicantUid: uid,
      imageBase64: image.base64,
      imageType: 'image/jpeg',
      fileName: file.name,
      fileSize: image.size,
      submittedAt: serverTimestamp()
    });

    await runInInjectionContext(
      this.injector,
      () => batch.commit()
    );
  }

  // ========================================
  // LOGIN
  // ========================================

  async login(form: NgForm): Promise<void> {
    if (this.loginLoading) return;

    if (form.invalid) {
      form.control.markAllAsTouched();

      await Swal.fire({
        icon: 'warning',
        title: 'Incomplete Information',
        text: 'Enter your email and password.',
        confirmButtonColor: '#245d43'
      });
      return;
    }

    this.loginLoading = true;
    let destination = '';

    try {
      await this.authService.login(
        this.email.trim(),
        this.password
      );

      const user = this.auth.currentUser;

      if (!user) {
        throw new Error('Unable to verify signed-in user.');
      }

      destination = await this.getAccountDestination(user.uid);

      sessionStorage.removeItem('silkmartGuestMode');

    } catch (error: any) {
      let title = 'Sign In Failed';
      let message = 'Unable to sign in.';
      let icon: 'error' | 'info' = 'error';

      if (
        ['auth/invalid-credential',
         'auth/wrong-password',
         'auth/user-not-found'].includes(error?.code)
      ) {
        message = 'Incorrect email or password.';
      } else if (error?.code === 'auth/invalid-email') {
        message = 'Please enter a valid email address.';
      } else if (error?.code === 'auth/too-many-requests') {
        message = 'Too many attempts. Please try again later.';
      } else if (error?.code === 'auth/network-request-failed') {
        message = 'Please check your internet connection.';
      } else if (error?.code === 'auth/user-disabled') {
        message = 'This account has been disabled.';
      } else if (error?.message === 'STAFF_ACCOUNT_NOT_APPROVED') {
        title = 'Application Pending';
        message = 'Your staff application is awaiting approval.';
        icon = 'info';
      } else if (error?.message === 'STAFF_ACCOUNT_REJECTED') {
        title = 'Application Rejected';
        message = 'Contact an administrator about your application.';
        icon = 'info';
      } else if (error?.message === 'Unable to verify account role.') {
        message = 'Unable to verify your account role.';
      }

      if (
        error?.message === 'STAFF_ACCOUNT_NOT_APPROVED' ||
        error?.message === 'STAFF_ACCOUNT_REJECTED'
      ) {
        try {
          await runInInjectionContext(
            this.injector,
            () => signOut(this.auth)
          );
        } catch (logoutError) {
          console.error('Logout error:', logoutError);
        }
      }

      await Swal.fire({
        icon,
        title,
        text: message,
        confirmButtonColor: '#245d43'
      });
      return;
    } finally {
      this.loginLoading = false;
    }

    await Swal.fire({
      icon: 'success',
      title: 'Welcome Back!',
      text: 'Successfully signed in to SilkMart.',
      confirmButtonColor: '#245d43',
      timer: 1800,
      timerProgressBar: true
    });

    this.closeLogin();

    const navigated = await this.router.navigate([destination]);

    if (!navigated) {
      await Swal.fire({
        icon: 'error',
        title: 'Dashboard Unavailable',
        text: 'Check the dashboard route configuration.',
        confirmButtonColor: '#245d43'
      });
    }
  }

  // ========================================
  // CREATE ACCOUNT
  // ========================================

  async createAccount(form: NgForm): Promise<void> {
    if (this.registerLoading) return;

    if (form.invalid) {
      form.control.markAllAsTouched();

      await Swal.fire({
        icon: 'warning',
        title: 'Incomplete Information',
        text: 'Please complete all required fields.',
        confirmButtonColor: '#245d43'
      });
      return;
    }

    if (this.registerPassword !== this.confirmPassword) {
      await Swal.fire({
        icon: 'warning',
        title: 'Passwords Do Not Match',
        text: 'Please make sure both passwords match.',
        confirmButtonColor: '#245d43'
      });
      return;
    }

    if (this.registerPassword.length < 6) {
      await Swal.fire({
        icon: 'warning',
        title: 'Password Too Short',
        text: 'Use a password with at least 6 characters.',
        confirmButtonColor: '#245d43'
      });
      return;
    }

    const accountType = this.selectedAccountType;

    if (accountType === 'staff' && !this.staffIdFile) {
      this.staffIdError = 'Please select a verification ID.';

      await Swal.fire({
        icon: 'warning',
        title: 'Verification ID Required',
        text: 'Please choose a JPG verification ID.',
        confirmButtonColor: '#245d43'
      });
      return;
    }

    this.registerLoading = true;

    let createdUser: Awaited<
      ReturnType<AuthServ['register']>
    >['user'] | null = null;

    let profileSaved = false;

    try {
      // Compress before creating Authentication account.
      let preparedImage: { base64: string; size: number } | null = null;

      if (accountType === 'staff' && this.staffIdFile) {
        preparedImage = await this.compressStaffId(this.staffIdFile);
      }

      const result = await this.authService.register(
        this.registerEmail.trim().toLowerCase(),
        this.registerPassword
      );

      createdUser = result.user;

      if (accountType === 'staff') {
        if (!this.staffIdFile || !preparedImage) {
          throw new Error('INVALID_VERIFICATION_IMAGE');
        }

        // Both Firestore documents commit together.
        await this.createStaffApplication(
          createdUser.uid,
          this.staffIdFile
        );

        profileSaved = true;

        await runInInjectionContext(
          this.injector,
          () => signOut(this.auth)
        );

        await Swal.fire({
          icon: 'success',
          title: 'Application Submitted!',
          text:
            'Your ID was saved securely. An administrator ' +
            'must approve your application before staff access.',
          confirmButtonColor: '#245d43'
        });

        this.clearRegisterForm();
        this.showRegisterForm = false;
        this.showLoginForm = false;

        await this.router.navigate(['/login']);
        this.openLogin();
        return;
      }

      await this.userService.createUserProfile(
        createdUser.uid,
        {
          fullName: this.fullName.trim(),
          email: this.registerEmail.trim().toLowerCase(),
          mobileNumber: this.mobileNumber.trim(),
          completeAddress: this.completeAddress.trim(),
          role: 'customer'
        } as Parameters<UserServ['createUserProfile']>[1]
      );

      profileSaved = true;
      sessionStorage.removeItem('silkmartGuestMode');

      await Swal.fire({
        icon: 'success',
        title: 'Account Created!',
        text: 'Your customer account was created successfully.',
        confirmButtonColor: '#245d43',
        timer: 2000
      });

      this.clearRegisterForm();
      this.showRegisterForm = false;
      this.showLoginForm = false;

      await this.router.navigate(['/home-cust']);

    } catch (error: any) {
      console.error('Registration failed:', error);

      let message =
        'Registration could not be completed.';

      if (error?.code === 'auth/email-already-in-use') {
        message =
          'This email is already registered. Please sign in.';
      } else if (error?.code === 'permission-denied') {
        message =
          'Firestore denied the operation. Check the published rules.';
      } else if (error?.message === 'INVALID_VERIFICATION_IMAGE') {
        message = 'Unable to read the JPG image.';
      } else if (error?.message === 'IMAGE_TOO_LARGE') {
        message =
          'The ID could not be compressed enough. ' +
          'Please use a smaller or clearer JPG.';
      }

      if (createdUser && !profileSaved) {
        try {
          await runInInjectionContext(
            this.injector,
            () => deleteUser(createdUser!)
          );
        } catch (cleanupError) {
          console.error('Account cleanup failed:', cleanupError);
          message +=
            ' The login account might already exist. ' +
            'Contact an administrator before registering again.';
        }
      }

      await Swal.fire({
        icon: 'error',
        title: 'Registration Failed',
        text: message,
        confirmButtonColor: '#245d43'
      });
    } finally {
      this.registerLoading = false;
    }
  }

  clearRegisterForm(): void {
    this.fullName = '';
    this.registerEmail = '';
    this.mobileNumber = '';
    this.completeAddress = '';
    this.registerPassword = '';
    this.confirmPassword = '';

    this.selectedAccountType = 'customer';

    this.resetStaffId();

    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  // ========================================
  // ACCOUNT DESTINATION
  // ========================================

  private getAccountDestination(uid: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let finished = false;
      let unsubscribe: (() => void) | null = null;

      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        unsubscribe?.();
        reject(new Error('Unable to verify account role.'));
      }, 10000);

      try {
        unsubscribe = this.userService.listenToUserProfile(
          uid,
          profile => {
            if (finished) return;

            finished = true;
            clearTimeout(timeout);

            queueMicrotask(() => unsubscribe?.());

            const role = String(
              profile?.role ?? ''
            ).toLowerCase();

            const status = String(
              (
                profile as typeof profile & {
                  approvalStatus?: string
                }
              )?.approvalStatus ?? ''
            ).toLowerCase();

            if (role === 'admin' || role === 'administrator') {
              resolve('/home-adm');
            } else if (role === 'staff') {
              if (status === 'pending' || status === 'rejected') {
                reject(new Error('STAFF_ACCOUNT_NOT_APPROVED'));
              } else {
                resolve('/home-adm');
              }
            } else if (role === 'customer') {
              resolve('/home-cust');
            } else if (role === 'pending_staff') {
              reject(new Error(
                status === 'rejected'
                  ? 'STAFF_ACCOUNT_REJECTED'
                  : 'STAFF_ACCOUNT_NOT_APPROVED'
              ));
            } else {
              reject(new Error('Unable to verify account role.'));
            }
          }
        );
      } catch (error) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  }
}
