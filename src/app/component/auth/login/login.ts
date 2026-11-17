import { CommonModule, Location } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  HostListener,
  Injector,
  NgZone,
  OnDestroy,
  runInInjectionContext
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

import {
  Auth,
  deleteUser,
  sendPasswordResetEmail,
  signOut
} from '@angular/fire/auth';

import {
  Firestore,
  collection,
  doc,
  getDocsFromServer,
  writeBatch,
  serverTimestamp
} from '@angular/fire/firestore';

import { AuthServ } from '../../../services/auth.serv';
import { UserServ } from '../../../services/user.serv';
import { VisitServ } from '../../../services/visit.serv';
import { JobbappServ } from '../../../services/jobbapp.serv';

type PublicForm = 'visit' | 'job';
type JobOpening = { id: string; title: string };

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class Login implements OnDestroy {

  publicForm: PublicForm | null = null;
  publicLoading = false;
  publicError = '';
  publicSuccess = '';
  visitTrackingUrl = '';
  visitTrackingCopyMessage = '';
  jobTrackingUrl = '';
  jobTrackingCopyMessage = '';
  openingsLoading = false;
  openingsError = false;
  jobOpenings: JobOpening[] = [];
  readonly visitPurposes = ['Company Tour', 'School Visit', 'Business Meeting', 'Research', 'Other'];

  visitor = {
    fullName: '', email: '', organization: '', purpose: '', otherPurpose: '',
    preferredDateTime: '', visitorCount: 1
  };
  applicant = {
    fullName: '', email: '', mobileNumber: '', openingId: '',
    desiredWork: '', skills: ''
  };

  resumeFile: File | null = null;
  resumeFileError = '';
  private readonly maxResumeBytes = 700 * 1024;

  showLoginForm = false;
  showRegisterForm = false;

  showForgotPassword = false;
  resetEmail = '';
  resetLoading = false;
  resetError = '';
  resetSent = false;

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
  private componentDestroyed = false;

  constructor(
    private router: Router,
    private authService: AuthServ,
    private userService: UserServ,
    private auth: Auth,
    private firestore: Firestore,
    private injector: Injector,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private visitService: VisitServ,
    private location: Location,
    private jobService: JobbappServ
  ) {}

  ngOnDestroy(): void {
    this.componentDestroyed = true;
    this.resetStaffId();
  }

  // Refresh registration status after Firebase operations.
  private setRegisterLoading(loading: boolean): void {
    this.zone.run(() => {
      this.registerLoading = loading;

      if (!this.componentDestroyed) {
        this.cdr.detectChanges();
      }
    });
  }

  private closeRegistrationAfterSuccess(): void {
    this.zone.run(() => {
      this.registerLoading = false;

      this.clearRegisterForm();

      this.showRegisterForm = false;
      this.showLoginForm = false;

      if (!this.componentDestroyed) {
        this.cdr.detectChanges();
      }
    });
  }

  openLogin(): void {
    this.showLoginForm = true;
    this.showRegisterForm = false;
    this.showForgotPassword = false;
    this.resetError = '';
    this.resetSent = false;
    this.showPassword = false;
  }

  closeLogin(): void {
    if (
      this.loginLoading ||
      this.registerLoading ||
      this.resetLoading ||
      this.publicLoading
    ) {
      return;
    }

    this.showLoginForm = false;
    this.showRegisterForm = false;
    this.showForgotPassword = false;
    this.resetError = '';
    this.resetSent = false;
    this.showPassword = false;
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
    this.backFromPublicForm();
  }

  openRegister(): void {
    this.showLoginForm = true;
    this.showRegisterForm = true;
    this.showForgotPassword = false;
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

    sessionStorage.setItem(
      'silkmartGuestMode',
      'true'
    );

    this.closeLogin();
    await this.router.navigate(['/home-cust']);
  }

  openPublicForm(kind: PublicForm): void {
    if (this.loginLoading || this.publicLoading) return;
    this.publicForm = kind;
    this.publicError = '';
    this.publicSuccess = '';
    this.visitTrackingUrl = '';
    this.visitTrackingCopyMessage = '';
    this.jobTrackingUrl = '';
    this.jobTrackingCopyMessage = '';
    if (kind === 'job') void this.loadPublicJobOpenings();
  }

  backFromPublicForm(): void {
    if (this.publicLoading) return;
    this.publicForm = null;
    this.publicError = '';
    this.publicSuccess = '';
    this.visitTrackingUrl = '';
    this.visitTrackingCopyMessage = '';
    this.jobTrackingUrl = '';
    this.jobTrackingCopyMessage = '';
  }

  async copyVisitTrackingLink(): Promise<void> {
    if (!this.visitTrackingUrl) return;

    const trackingUrl = this.visitTrackingUrl;
    let message: string;

    try {
      await navigator.clipboard.writeText(trackingUrl);
      message = 'Tracking link copied.';
    } catch {
      message = 'Select the tracking link above and copy it manually.';
    }

    if (!this.componentDestroyed && this.visitTrackingUrl === trackingUrl) {
      this.visitTrackingCopyMessage = message;
      this.cdr.detectChanges();
    }
  }

  async copyJobTrackingLink(): Promise<void> {
    if (!this.jobTrackingUrl) return;

    const trackingUrl = this.jobTrackingUrl;
    let message: string;

    try {
      await navigator.clipboard.writeText(trackingUrl);
      message = 'Tracking link copied.';
    } catch {
      message = 'Select the tracking link above and copy it manually.';
    }

    if (!this.componentDestroyed && this.jobTrackingUrl === trackingUrl) {
      this.jobTrackingCopyMessage = message;
      this.cdr.detectChanges();
    }
  }

  async loadPublicJobOpenings(): Promise<void> {
    if (this.openingsLoading) return;
    this.openingsLoading = true;
    this.openingsError = false;

    try {
      const snapshot = await runInInjectionContext(
        this.injector,
        () => getDocsFromServer(collection(this.firestore, 'job_openings'))
      );
      const openings: JobOpening[] = [];
      for (const opening of snapshot.docs) {
        const title = opening.get('title');
        if (typeof title === 'string' && title.trim()) {
          openings.push({ id: opening.id, title: title.trim() });
        }
      }
      this.jobOpenings = openings.sort((first, second) => first.title.localeCompare(second.title));
      if (!this.jobOpenings.some(opening => opening.id === this.applicant.openingId)) {
        this.applicant.openingId = '';
      }
    } catch {
      this.openingsError = true;
      this.applicant.openingId = '';
      this.jobOpenings = [];
    } finally {
      this.openingsLoading = false;
      if (!this.componentDestroyed) this.cdr.detectChanges();
    }
  }

  onResumeSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.resumeFile = null;
    this.resumeFileError = '';

    if (!file) return;

    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      this.resumeFileError = 'Choose a PDF for your résumé or portfolio.';
    } else if (file.size === 0 || file.size > this.maxResumeBytes) {
      this.resumeFileError = 'Choose a non-empty PDF no larger than 700 KB.';
    } else {
      this.resumeFile = file;
      return;
    }

    input.value = '';
  }

  clearResumeFile(input: HTMLInputElement): void {
    if (this.publicLoading) return;

    this.resumeFile = null;
    this.resumeFileError = '';
    input.value = '';
  }

  async submitPublicForm(form: NgForm): Promise<void> {
    const kind = this.publicForm;
    if (!kind || this.publicLoading || this.publicSuccess) return;
    this.publicError = '';

    if (form.invalid) {
      form.control.markAllAsTouched();
      this.publicError = 'Complete the required fields and check the values you entered.';
      return;
    }

    const submission = kind === 'visit'
      ? { kind, payload: this.visitPayload() }
      : { kind, payload: this.jobPayload() };
    if (!submission.payload) return;

    const resumeFile = this.resumeFile;
    if (kind === 'job' && !resumeFile) {
      this.resumeFileError ||= 'Choose a PDF for your résumé or portfolio.';
      return;
    }

    this.publicLoading = true;
    try {
      if (submission.kind === 'visit') {
        const { trackingToken } = await this.visitService.submitRequest(submission.payload);
        const route = this.router.createUrlTree(['/track-visit', trackingToken]);
        const path = this.location.prepareExternalUrl(this.router.serializeUrl(route));
        this.visitTrackingUrl = new URL(path, document.baseURI).href;
        this.visitor = {
          fullName: '', email: '', organization: '', purpose: '', otherPurpose: '',
          preferredDateTime: '', visitorCount: 1
        };
        this.publicSuccess = 'Visit request received. Our team will review your preferred schedule.';
      } else {
        if (!resumeFile) return;
        const attachment = await this.encodeResumeFile(resumeFile);
        if (!attachment) return;

        const opening = this.jobOpenings.find(item => item.id === submission.payload?.openingId);
        const { trackingToken } = await this.jobService.submitApplication({
          ...submission.payload,
          openingId: opening?.id ?? null,
          openingTitle: opening?.title ?? null,
          resumeFile: attachment
        });
        const route = this.router.createUrlTree(['/track-application', trackingToken]);
        const path = this.location.prepareExternalUrl(this.router.serializeUrl(route));
        this.jobTrackingUrl = new URL(path, document.baseURI).href;

        this.applicant = {
          fullName: '', email: '', mobileNumber: '', openingId: '',
          desiredWork: '', skills: ''
        };
        this.resumeFile = null;
        this.resumeFileError = '';
        this.publicSuccess = 'Application received. Save your tracking link to check its status.';
      }
    } catch (error: unknown) {
      const code = (error as { code?: string } | null)?.code;
      if (kind === 'visit' && code === 'permission-denied') {
        this.publicError = 'The visit request could not be saved. Check your details and try again.';
      } else {
        this.publicError = 'We couldn’t confirm your submission. Your entries are still here.';
      }
    } finally {
      this.publicLoading = false;
      if (!this.componentDestroyed) this.cdr.detectChanges();
    }
  }

  private visitPayload() {
    const visitor = this.visitor;
    const fullName = visitor.fullName.trim();
    const otherPurpose = visitor.purpose === 'Other' ? visitor.otherPurpose.trim() : '';
    if (!fullName || !this.visitPurposes.includes(visitor.purpose) ||
        (visitor.purpose === 'Other' && !otherPurpose) ||
        !Number.isSafeInteger(visitor.visitorCount) || visitor.visitorCount < 1) {
      this.publicError = 'Enter a name, a visit purpose, and a whole number of visitors of at least 1.';
      return null;
    }

    const preferred = new Date(visitor.preferredDateTime + '+08:00');
    if (!(preferred.getTime() > Date.now())) {
      this.publicError = 'Choose a future visit date and time.';
      return null;
    }

    return {
      fullName,
      email: visitor.email.trim(),
      organization: visitor.organization.trim(),
      purpose: visitor.purpose,
      otherPurpose,
      preferredDateTime: preferred.toISOString(),
      visitorCount: visitor.visitorCount
    };
  }

  private jobPayload() {
    const applicant = this.applicant;
    const fullName = applicant.fullName.trim();
    const mobileNumber = applicant.mobileNumber.trim().replace(/[\s()-]/g, '');
    const desiredWork = applicant.desiredWork.trim();
    const skills = applicant.skills.trim();
    if (!fullName || !/^\+?\d{7,15}$/.test(mobileNumber) || !desiredWork || !skills) {
      this.publicError = 'Enter your name, a valid mobile number, the work you want, and your relevant skills.';
      return null;
    }

    return {
      fullName,
      email: applicant.email.trim(),
      mobileNumber,
      openingId: applicant.openingId || null,
      desiredWork,
      skills
    };
  }

  private async encodeResumeFile(file: File) {
    try {
      const header = await file.slice(0, 5).text();
      if (header !== '%PDF-') {
        this.resumeFileError = 'This file is not a valid PDF. Choose a different file.';
        return null;
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.onabort = () => reject(new Error('File read cancelled.'));
        reader.readAsDataURL(file);
      });
      const encoded = dataUrl.split(',')[1];
      if (!encoded) throw new Error('Missing file data.');

      this.resumeFileError = '';
      return {
        fileName: file.name,
        contentType: 'application/pdf',
        size: file.size,
        base64: `data:application/pdf;base64,${encoded}`
      };
    } catch {
      this.resumeFileError = 'Unable to read this PDF. Choose the file again.';
      return null;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.publicForm) {
      this.backFromPublicForm();
      return;
    }

    if (
      this.showLoginForm &&
      !this.loginLoading &&
      !this.registerLoading &&
      !this.resetLoading
    ) {
      this.closeLogin();
    }
  }

  // ========================================
  // FORGOT PASSWORD
  // ========================================

  openForgotPassword(): void {
    if (
      this.loginLoading ||
      this.registerLoading
    ) {
      return;
    }

    this.showForgotPassword = true;
    this.resetEmail = this.email.trim();
    this.resetError = '';
    this.resetSent = false;
  }

  backFromForgotPassword(): void {
    if (this.resetLoading) return;

    this.showForgotPassword = false;
    this.resetError = '';
    this.resetSent = false;
  }

  async sendResetEmail(form: NgForm): Promise<void> {
    if (this.resetLoading || this.resetSent) return;

    this.resetError = '';

    if (form.invalid || !this.resetEmail.trim()) {
      form.control.markAllAsTouched();
      this.resetError = 'Enter a valid email address.';
      return;
    }

    this.resetLoading = true;

    try {
      await runInInjectionContext(
        this.injector,
        () => sendPasswordResetEmail(
          this.auth,
          this.resetEmail.trim().toLowerCase()
        )
      );

      this.resetSent = true;

    } catch (error: any) {
      console.error(
        'Password reset request failed:',
        error
      );

      if (error?.code === 'auth/invalid-email') {
        this.resetError =
          'Enter a valid email address.';

      } else if (error?.code === 'auth/too-many-requests') {
        this.resetError =
          'Too many requests. Please try again later.';

      } else if (error?.code === 'auth/network-request-failed') {
        this.resetError =
          'Please check your internet connection.';

      } else if (error?.code === 'auth/user-not-found') {
        this.resetSent = true;

      } else {
        this.resetError =
          'Unable to send the reset email. Please try again.';
      }

    } finally {
      this.resetLoading = false;
      this.cdr.detectChanges();
    }
  }

  // ========================================
  // STAFF VERIFICATION JPG SELECTION
  // ========================================

  onStaffIdSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;

    this.resetStaffId();

    if (!file) return;

    const name = file.name.toLowerCase();

    if (
      file.type !== 'image/jpeg' ||
      !(
        name.endsWith('.jpg') ||
        name.endsWith('.jpeg')
      )
    ) {
      this.staffIdError =
        'Choose a JPG or JPEG image.';

      input.value = '';
      return;
    }

    if (
      file.size === 0 ||
      file.size > 15 * 1024 * 1024
    ) {
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
      URL.revokeObjectURL(
        this.staffIdPreviewUrl
      );
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
  // JPG COMPRESSION
  // ========================================

  private async compressStaffId(
    file: File
  ): Promise<{
    base64: string;
    size: number;
  }> {
    const originalUrl = URL.createObjectURL(file);

    try {
      const image = new Image();

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();

        image.onerror = () =>
          reject(
            new Error('INVALID_VERIFICATION_IMAGE')
          );

        image.src = originalUrl;
      });

      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 50000000
      ) {
        throw new Error(
          'INVALID_VERIFICATION_IMAGE'
        );
      }

      const canvas =
        document.createElement('canvas');

      const context =
        canvas.getContext('2d');

      if (!context) {
        throw new Error(
          'IMAGE_PROCESSING_FAILED'
        );
      }

      for (
        const maxDimension of [
          1600, 1400, 1200, 1000, 800, 640
        ]
      ) {
        const ratio = Math.min(
          1,
          maxDimension /
            Math.max(
              image.naturalWidth,
              image.naturalHeight
            )
        );

        canvas.width = Math.max(
          1,
          Math.round(
            image.naturalWidth * ratio
          )
        );

        canvas.height = Math.max(
          1,
          Math.round(
            image.naturalHeight * ratio
          )
        );

        context.fillStyle = '#ffffff';

        context.fillRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

        context.drawImage(
          image,
          0,
          0,
          canvas.width,
          canvas.height
        );

        for (
          const quality of [
            0.85, 0.75, 0.65, 0.5, 0.4
          ]
        ) {
          const base64 = canvas.toDataURL(
            'image/jpeg',
            quality
          );

          const encoded =
            base64.split(',')[1] || '';

          const size = Math.floor(
            encoded.length * 3 / 4
          );

          if (
            size > 0 &&
            size <= this.maxJpgBytes &&
            base64.length < 500000
          ) {
            return {
              base64,
              size
            };
          }
        }
      }

      throw new Error(
        'IMAGE_TOO_LARGE'
      );

    } finally {
      URL.revokeObjectURL(originalUrl);
    }
  }

  // ========================================
  // STAFF REGISTRATION FIRESTORE BATCH
  // ========================================

  private async createStaffApplication(
    uid: string,
    fileName: string,
    image: {
      base64: string;
      size: number;
    }
  ): Promise<void> {

    const userRef = runInInjectionContext(
      this.injector,
      () => doc(
        this.firestore,
        'users',
        uid
      )
    );

    const verificationRef = runInInjectionContext(
      this.injector,
      () => doc(
        this.firestore,
        'staff_verifications',
        uid
      )
    );

    const batch = runInInjectionContext(
      this.injector,
      () => writeBatch(
        this.firestore
      )
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
      verificationImagePath:
        `staff_verifications/${uid}`,
      staffAppliedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });

    batch.set(verificationRef, {
      applicantUid: uid,
      imageBase64: image.base64,
      imageType: 'image/jpeg',
      fileName,
      fileSize: image.size,
      submittedAt: serverTimestamp()
    });

    await runInInjectionContext(
      this.injector,
      () => {
        const notificationRef = doc(
          this.firestore,
          'admin_notifications',
          'staff-registration-' + uid
        );

        batch.set(notificationRef, {
          type: 'staff_registration',
          createdAt: serverTimestamp()
        });

        return batch.commit();
      }
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
        throw new Error(
          'Unable to verify signed-in user.'
        );
      }

      destination =
        await this.getAccountDestination(user.uid);

      sessionStorage.removeItem(
        'silkmartGuestMode'
      );

    } catch (error: any) {
      let title = 'Sign In Failed';
      let message = 'Unable to sign in.';
      let icon: 'error' | 'info' = 'error';

      if (
        [
          'auth/invalid-credential',
          'auth/wrong-password',
          'auth/user-not-found'
        ].includes(error?.code)
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

      } else if (
        error?.message === 'STAFF_ACCOUNT_NOT_APPROVED'
      ) {
        title = 'Application Pending';
        message =
          'Your staff application is awaiting approval.';
        icon = 'info';

      } else if (
        error?.message === 'STAFF_ACCOUNT_REJECTED'
      ) {
        title = 'Application Rejected';
        message =
          'Contact an administrator about your application.';
        icon = 'info';

      } else if (
        error?.message === 'Unable to verify account role.'
      ) {
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
          console.error(
            'Logout error:',
            logoutError
          );
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

    const navigated =
      await this.router.navigate([destination]);

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
    const staffFile = this.staffIdFile;

    const fullName = this.fullName.trim();
    const email =
      this.registerEmail.trim().toLowerCase();

    const mobileNumber =
      this.mobileNumber.trim();

    const completeAddress =
      this.completeAddress.trim();

    const password = this.registerPassword;

    if (
      accountType === 'staff' &&
      !staffFile
    ) {
      this.staffIdError =
        'Please select a verification ID.';

      await Swal.fire({
        icon: 'warning',
        title: 'Verification ID Required',
        text: 'Please choose a JPG verification ID.',
        confirmButtonColor: '#245d43'
      });
      return;
    }

    this.setRegisterLoading(true);

    let createdUser: Awaited<
      ReturnType<AuthServ['register']>
    >['user'] | null = null;

    let profileSaved = false;

    // Firebase Auth and Firestore must both succeed.
    try {
      let preparedImage: {
        base64: string;
        size: number;
      } | null = null;

      // Compress the staff ID only once.
      if (
        accountType === 'staff' &&
        staffFile
      ) {
        preparedImage =
          await this.compressStaffId(staffFile);
      }

      // Create Firebase Authentication account.
      const result =
        await this.authService.register(
          email,
          password
        );

      createdUser = result.user;

      if (accountType === 'staff') {
        if (
          !staffFile ||
          !preparedImage
        ) {
          throw new Error(
            'INVALID_VERIFICATION_IMAGE'
          );
        }

        // Save both staff documents in one batch.
        await this.createStaffApplication(
          createdUser.uid,
          staffFile.name,
          preparedImage
        );

      } else {
        // Create customer profile.
        await this.userService.createUserProfile(
          createdUser.uid,
          {
            fullName,
            email,
            mobileNumber,
            completeAddress,
            role: 'customer'
          } as Parameters<
            UserServ['createUserProfile']
          >[1]
        );
      }

      profileSaved = true;

    } catch (error: any) {
      console.error(
        'Registration failed:',
        error
      );

      let message =
        'Registration could not be completed.';

      if (
        error?.code === 'auth/email-already-in-use'
      ) {
        message =
          'This email is already registered. Please sign in.';

      } else if (
        error?.code === 'permission-denied' ||
        error?.code === 'firestore/permission-denied'
      ) {
        message =
          'Firestore denied registration. Check the published rules.';

      } else if (
        error?.code === 'auth/network-request-failed' ||
        error?.code === 'unavailable'
      ) {
        message =
          'Connection unavailable. Check Firebase and your internet connection.';

      } else if (
        error?.message === 'INVALID_VERIFICATION_IMAGE'
      ) {
        message =
          'Unable to read the JPG image.';

      } else if (
        error?.message === 'IMAGE_TOO_LARGE'
      ) {
        message =
          'The ID could not be compressed enough. Please use a smaller JPG.';
      }

      if (
        createdUser &&
        !profileSaved
      ) {
        // Attempt to clean up incomplete registration.
        try {
          await runInInjectionContext(
            this.injector,
            () => deleteUser(createdUser!)
          );

        } catch (cleanupError) {
          console.error(
            'Account cleanup failed:',
            cleanupError
          );

          message +=
            ' The Authentication account may still exist. ' +
            'Do not register again with the same email; ' +
            'contact an administrator.';
        }
      }

      // Stop the spinner before displaying the error.
      this.setRegisterLoading(false);

      await Swal.fire({
        icon: 'error',
        title: 'Registration Failed',
        text: message,
        confirmButtonColor: '#245d43'
      });

      return;

    } finally {
      // Update Angular immediately after Firebase settles.
      this.setRegisterLoading(false);
    }

    // ========================================
    // REGISTRATION SUCCESS
    // ========================================

    // Firestore has confirmed the save.
    // Close the form before showing any popup.
    this.closeRegistrationAfterSuccess();

    // ========================================
    // STAFF APPLICATION SUCCESS
    // ========================================

    if (accountType === 'staff') {
      await Swal.fire({
        icon: 'success',
        title: 'Application Submitted!',
        text:
          'Your staff ID and application were saved. ' +
          'An administrator must approve your account ' +
          'before staff access.',
        confirmButtonColor: '#245d43'
      });

      try {
        await runInInjectionContext(
          this.injector,
          () => signOut(this.auth)
        );

      } catch (signOutError) {
        console.error(
          'Sign-out after staff registration failed:',
          signOutError
        );

        await Swal.fire({
          icon: 'warning',
          title: 'Application Saved',
          text:
            'Your application was submitted, but ' +
            'automatic sign-out failed. Sign out ' +
            'before using another account.',
          confirmButtonColor: '#245d43'
        });

        return;
      }

      const navigated =
        await this.router.navigate(['/login']);

      if (
        navigated &&
        !this.componentDestroyed
      ) {
        this.openLogin();
      }

      return;
    }

    // ========================================
    // CUSTOMER REGISTRATION SUCCESS
    // ========================================

    sessionStorage.removeItem(
      'silkmartGuestMode'
    );

    await Swal.fire({
      icon: 'success',
      title: 'Account Created!',
      text:
        'Your customer account was created successfully.',
      confirmButtonColor: '#245d43',
      timer: 2000,
      timerProgressBar: true
    });

    await this.router.navigate([
      '/home-cust'
    ]);
  }

  // ========================================
  // CLEAR REGISTRATION FORM
  // ========================================

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

  private getAccountDestination(
    uid: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let finished = false;

      let unsubscribe:
        (() => void) | null = null;

      const timeout = setTimeout(() => {
        if (finished) return;

        finished = true;
        unsubscribe?.();

        reject(
          new Error(
            'Unable to verify account role.'
          )
        );
      }, 10000);

      try {
        unsubscribe =
          this.userService.listenToUserProfile(
            uid,
            profile => {
              if (finished) return;

              finished = true;
              clearTimeout(timeout);

              queueMicrotask(
                () => unsubscribe?.()
              );

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

              if (
                role === 'admin' ||
                role === 'administrator'
              ) {
                resolve('/home-adm');

              } else if (role === 'staff') {
                if (
                  status === 'pending' ||
                  status === 'rejected'
                ) {
                  reject(
                    new Error(
                      'STAFF_ACCOUNT_NOT_APPROVED'
                    )
                  );
                } else {
                  resolve('/home-adm');
                }

              } else if (role === 'customer') {
                resolve('/home-cust');

              } else if (role === 'pending_staff') {
                reject(
                  new Error(
                    status === 'rejected'
                      ? 'STAFF_ACCOUNT_REJECTED'
                      : 'STAFF_ACCOUNT_NOT_APPROVED'
                  )
                );

              } else {
                reject(
                  new Error(
                    'Unable to verify account role.'
                  )
                );
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