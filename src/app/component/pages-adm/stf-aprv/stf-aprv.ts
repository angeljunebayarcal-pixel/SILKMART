
import { CommonModule } from '@angular/common';
import {
  Component,
  OnInit,
  OnDestroy,
  Injector,
  NgZone,
  ChangeDetectorRef,
  runInInjectionContext
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  Auth,
  onAuthStateChanged
} from '@angular/fire/auth';

import {
  Firestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp
} from '@angular/fire/firestore';

import Swal from 'sweetalert2';

type ApprovalFilter =
  | 'all'
  | 'pending'
  | 'approved'
  | 'rejected';

interface StaffApplication {
  id: string;
  fullName: string;
  email: string;
  mobileNumber: string;
  completeAddress: string;
  role: string;
  approvalStatus: string;
  requestedRole: string;
  verificationImagePath: string;
  appliedAt: unknown;
  reviewedAt: unknown;
  rejectionReason: string;
}

@Component({
  selector: 'app-stf-aprv',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stf-aprv.html',
  styleUrl: './stf-aprv.scss'
})
export class StfAprv implements OnInit, OnDestroy {

  applications: StaffApplication[] = [];

  filter: ApprovalFilter = 'pending';
  search = '';

  loading = true;
  saving = false;
  error = '';

  isAuthorizedAdmin = false;

  selectedApplicant: StaffApplication | null = null;

  showDetails = false;
  imageLoading = false;
  imageError = '';
  verificationImageUrl = '';

  private adminUid = '';
  private session = 0;
  private reviewSession = 0;

  private verifiedIds = new Set<string>();

  private stopAuth: (() => void) | null = null;
  private stopApplications: (() => void) | null = null;

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.stopAuth = runInInjectionContext(
      this.injector,
      () => onAuthStateChanged(this.auth, user => {
        this.zone.run(async () => {
          const currentSession = ++this.session;

          this.stopApplications?.();
          this.stopApplications = null;
          this.verifiedIds.clear();

          this.adminUid = user?.uid || '';
          this.isAuthorizedAdmin = false;
          this.applications = [];
          this.loading = true;
          this.error = '';

          if (!user) {
            this.loading = false;
            this.error = 'Please sign in as an administrator.';
            this.refresh();
            return;
          }

          try {
            const profile = await runInInjectionContext(
              this.injector,
              () => getDoc(
                doc(this.firestore, 'users', user.uid)
              )
            );

            if (currentSession !== this.session) return;

            const role = String(
              profile.data()?.['role'] || ''
            ).toLowerCase();

            this.isAuthorizedAdmin =
              role === 'admin' ||
              role === 'administrator';

            if (!this.isAuthorizedAdmin) {
              this.error =
                'Only administrators may review staff applications.';
              this.loading = false;
              this.refresh();
              return;
            }

            this.loadApplications(currentSession);

          } catch (error) {
            if (currentSession !== this.session) return;

            console.error('Admin verification error:', error);

            this.error =
              'Unable to verify administrator permission.';
            this.loading = false;
            this.refresh();
          }
        });
      })
    );
  }

  ngOnDestroy(): void {
    this.session++;
    this.reviewSession++;

    this.stopApplications?.();
    this.stopAuth?.();
  }

  private refresh(): void {
    this.cdr.detectChanges();
  }

  private loadApplications(session: number): void {
    this.stopApplications?.();

    // Query staff applicants, not every customer.
    const applicantsQuery = runInInjectionContext(
      this.injector,
      () => query(
        collection(this.firestore, 'users'),
        where('requestedRole', '==', 'staff')
      )
    );

    this.stopApplications = runInInjectionContext(
      this.injector,
      () => onSnapshot(
        applicantsQuery,
        snapshot => {
          this.zone.run(() => {
            if (session !== this.session) return;

            this.applications = snapshot.docs.map(userDoc => {
              const data = userDoc.data();

              return {
                id: userDoc.id,
                fullName: String(
                  data['fullName'] || 'Unknown Applicant'
                ),
                email: String(data['email'] || ''),
                mobileNumber: String(data['mobileNumber'] || ''),
                completeAddress: String(
                  data['completeAddress'] || ''
                ),
                role: String(data['role'] || ''),
                requestedRole: String(
                  data['requestedRole'] || ''
                ),
                approvalStatus: String(
                  data['approvalStatus'] || ''
                ),
                verificationImagePath: '',
                appliedAt:
                  data['staffAppliedAt'] ||
                  data['createdAt'] ||
                  null,
                reviewedAt: data['reviewedAt'] || null,
                rejectionReason: String(
                  data['rejectionReason'] || ''
                )
              } as StaffApplication;
            });

            // Check actual verification documents.
            void this.loadVerificationStatuses(
              session,
              this.applications
            );

            if (this.selectedApplicant) {
              const updated = this.applications.find(
                app => app.id === this.selectedApplicant?.id
              );

              if (updated) {
                this.selectedApplicant = updated;
              }
            }

            this.loading = false;
            this.error = '';
            this.refresh();
          });
        },
        error => {
          this.zone.run(() => {
            if (session !== this.session) return;

            console.error('Staff applications error:', error);
            this.loading = false;
            this.error =
              'Unable to retrieve staff applications. Check Firestore rules.';
            this.refresh();
          });
        }
      )
    );
  }

  private async loadVerificationStatuses(
    session: number,
    applicants: StaffApplication[]
  ): Promise<void> {
    const results = await Promise.allSettled(
      applicants.map(async applicant => {
        const snapshot = await runInInjectionContext(
          this.injector,
          () => getDoc(
            doc(
              this.firestore,
              'staff_verifications',
              applicant.id
            )
          )
        );

        return {
          uid: applicant.id,
          exists: snapshot.exists() &&
            typeof snapshot.data()?.['imageBase64'] === 'string' &&
            String(snapshot.data()?.['imageBase64'])
              .startsWith('data:image/jpeg;base64,')
        };
      })
    );

    if (session !== this.session) return;

    const existingIds = new Set<string>();

    for (const result of results) {
      if (
        result.status === 'fulfilled' &&
        result.value.exists
      ) {
        existingIds.add(result.value.uid);
      }
    }

    this.verifiedIds = existingIds;

    this.zone.run(() => {
      for (const app of this.applications) {
        app.verificationImagePath =
          existingIds.has(app.id)
            ? `staff_verifications/${app.id}`
            : '';
      }

      this.refresh();
    });
  }

  get pendingCount(): number {
    return this.applications.filter(
      app => this.isPending(app)
    ).length;
  }

  get approvedCount(): number {
    return this.applications.filter(
      app => app.approvalStatus === 'approved'
    ).length;
  }

  get rejectedCount(): number {
    return this.applications.filter(
      app => app.approvalStatus === 'rejected'
    ).length;
  }

  get filteredApplications(): StaffApplication[] {
    const search = this.search.trim().toLowerCase();

    return this.applications.filter(app => {
      const matchesSearch =
        !search ||
        [
          app.fullName,
          app.email,
          app.mobileNumber,
          app.id
        ].some(value =>
          value.toLowerCase().includes(search)
        );

      const status = app.approvalStatus ||
        (
          app.role === 'pending_staff'
            ? 'pending'
            : ''
        );

      return matchesSearch &&
        (
          this.filter === 'all' ||
          status === this.filter
        );
    });
  }

  isPending(app: StaffApplication): boolean {
    return app.approvalStatus === 'pending' ||
      (
        app.role === 'pending_staff' &&
        !app.approvalStatus
      );
  }

  setFilter(value: ApprovalFilter): void {
    this.filter = value;
  }

  formatDate(value: any): string {
    if (!value) return 'Not recorded';

    const date =
      typeof value.toDate === 'function'
        ? value.toDate()
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'Not recorded';
    }

    return date.toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  async viewApplication(
    applicant: StaffApplication
  ): Promise<void> {
    this.selectedApplicant = applicant;
    this.showDetails = true;

    this.verificationImageUrl = '';
    this.imageError = '';
    this.imageLoading = true;

    const session = this.session;
    const review = ++this.reviewSession;

    try {
      const snapshot = await runInInjectionContext(
        this.injector,
        () => getDoc(
          doc(
            this.firestore,
            'staff_verifications',
            applicant.id
          )
        )
      );

      if (
        session !== this.session ||
        review !== this.reviewSession ||
        this.selectedApplicant?.id !== applicant.id
      ) {
        return;
      }

      if (!snapshot.exists()) {
        this.imageError =
          'No verification ID was submitted.';
        this.verifiedIds.delete(applicant.id);
        applicant.verificationImagePath = '';
        return;
      }

      const base64 = snapshot.data()['imageBase64'];

      if (
        typeof base64 !== 'string' ||
        !base64.startsWith('data:image/jpeg;base64,')
      ) {
        this.imageError =
          'The verification ID is invalid.';
        this.verifiedIds.delete(applicant.id);
        applicant.verificationImagePath = '';
        return;
      }

      this.verifiedIds.add(applicant.id);
      applicant.verificationImagePath =
        `staff_verifications/${applicant.id}`;

      this.verificationImageUrl = base64;

    } catch (error) {
      console.error('Verification error:', error);
      this.imageError =
        'Unable to load the ID. Check Firestore permissions.';

    } finally {
      if (
        session === this.session &&
        review === this.reviewSession
      ) {
        this.imageLoading = false;
        this.refresh();
      }
    }
  }

  closeDetails(): void {
    if (this.saving) return;

    this.reviewSession++;

    this.showDetails = false;
    this.selectedApplicant = null;
    this.verificationImageUrl = '';
    this.imageError = '';
    this.imageLoading = false;
  }

  
async approve(app: StaffApplication): Promise<void> {
  if (
    !this.isAuthorizedAdmin ||
    !this.isPending(app) ||
    this.saving
  ) {
    return;
  }

  if (
    this.selectedApplicant?.id !== app.id ||
    !this.verifiedIds.has(app.id) ||
    !this.verificationImageUrl
  ) {
    await Swal.fire({
      icon: 'warning',
      title: 'Verification Required',
      text: 'View the submitted ID before approval.',
      confirmButtonColor: '#287156'
    });
    return;
  }

  // Hide Review Application before showing SweetAlert
  this.showDetails = false;
  this.refresh();

  const result = await Swal.fire({
    icon: 'question',
    title: 'Approve Staff Application?',
    text: `Grant staff access to ${app.fullName}?`,
    showCancelButton: true,
    confirmButtonText: 'Approve Staff',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#287156',
    background: '#fbfaf4',
    heightAuto: false
  });

  // Restore Review Application if cancelled
  if (!result.isConfirmed) {
    this.showDetails = true;
    this.refresh();
    return;
  }

  this.saving = true;

  try {
    await runInInjectionContext(
      this.injector,
      () => updateDoc(
        doc(this.firestore, 'users', app.id),
        {
          role: 'staff',
          requestedRole: 'staff',
          approvalStatus: 'approved',
          reviewedBy: this.adminUid,
          reviewedAt: serverTimestamp(),
          rejectionReason: ''
        }
      )
    );

    this.saving = false;
    this.closeDetails();

    await Swal.fire({
      icon: 'success',
      title: 'Application Approved',
      text: `${app.fullName} can now access the staff dashboard.`,
      confirmButtonColor: '#287156',
      timer: 1800,
      heightAuto: false
    });

  } catch (error) {
    this.saving = false;
    console.error('Approval error:', error);

    await Swal.fire({
      icon: 'error',
      title: 'Unable to Approve',
      text: 'Check administrator permissions and Firestore rules.',
      confirmButtonColor: '#287156',
      heightAuto: false
    });

    this.showDetails = true;
    this.refresh();
  }
}


async reject(app: StaffApplication): Promise<void> {
  if (
    !this.isAuthorizedAdmin ||
    !this.isPending(app) ||
    this.saving
  ) {
    return;
  }

  // Hide Review Application before showing SweetAlert
  this.showDetails = false;
  this.refresh();

  const result = await Swal.fire({
    icon: 'warning',
    title: 'Reject Application?',
    input: 'textarea',
    inputLabel: 'Reason for rejection',
    inputPlaceholder: 'Explain the reason...',
    inputAttributes: {
      maxlength: '500'
    },
    inputValidator: value => {
      if (!value.trim()) {
        return 'Please provide a reason.';
      }
      return null;
    },
    showCancelButton: true,
    confirmButtonText: 'Reject Application',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#b8524b',
    background: '#fbfaf4',
    heightAuto: false
  });

  // Restore Review Application if cancelled
  if (!result.isConfirmed) {
    this.showDetails = true;
    this.refresh();
    return;
  }

  const reason = String(result.value || '').trim();
  this.saving = true;

  try {
    await runInInjectionContext(
      this.injector,
      () => updateDoc(
        doc(this.firestore, 'users', app.id),
        {
          role: 'pending_staff',
          requestedRole: 'staff',
          approvalStatus: 'rejected',
          rejectionReason: reason,
          reviewedBy: this.adminUid,
          reviewedAt: serverTimestamp()
        }
      )
    );

    this.saving = false;
    this.closeDetails();

    await Swal.fire({
      icon: 'success',
      title: 'Application Rejected',
      text: 'The applicant was not granted staff access.',
      confirmButtonColor: '#287156',
      timer: 1800,
      heightAuto: false
    });

  } catch (error) {
    this.saving = false;
    console.error('Rejection error:', error);

    await Swal.fire({
      icon: 'error',
      title: 'Unable to Reject',
      text: 'Check your Firestore security rules.',
      confirmButtonColor: '#287156',
      heightAuto: false
    });

    this.showDetails = true;
    this.refresh();
  }
}
}
