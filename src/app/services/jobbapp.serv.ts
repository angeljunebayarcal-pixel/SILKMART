import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type FirestoreError,
  type Timestamp
} from '@angular/fire/firestore';

export type JobStatus = 'new' | 'under_review' | 'shortlisted' | 'confirmed' | 'rejected' | 'closed';
export type JobAction = 'review' | 'confirm' | 'reject' | 'close';

export interface JobOpening {
  id: string;
  title: string;
}

export interface JobResume {
  fileName: string;
  contentType: string;
  base64: string;
  size: number;
}

export interface JobSubmission {
  fullName: string;
  email: string;
  mobileNumber: string;
  openingId: string | null;
  openingTitle?: string | null;
  desiredWork: string;
  skills: string;
  resumeFile: JobResume;
}

export interface JobApplication extends Omit<JobSubmission, 'openingId' | 'resumeFile'> {
  id: string;
  openingId?: string | null;
  resumeFile?: JobResume;
  createdAt?: Timestamp;
  applicantNote?: string;
  trackingEnabled?: boolean;
  status: JobStatus;
}

export interface JobTracking {
  status: JobStatus;
  applicantNote: string;
}

type JobUpdate = {
  applicationId: string;
  expectedStatus: JobStatus;
  action: JobAction;
  applicantNote?: string;
  expectedApplicantNote?: string;
};

const pendingStatuses = ['new', 'under_review', 'shortlisted'] as const;

export const allowedJobActions: Record<JobAction, readonly JobStatus[]> = {
  review: ['new'],
  confirm: pendingStatuses,
  reject: pendingStatuses,
  close: pendingStatuses
};

const nextStatus = {
  review: 'under_review',
  confirm: 'confirmed',
  reject: 'rejected',
  close: 'closed'
} as const;

const applicationCollection = 'job_applications';
const trackingCollection = 'job_application_tracking';
const openingCollection = 'job_openings';
const trackingTokenPattern = /^[a-f0-9]{64}$/;

export class JobUpdateError extends Error {}

@Injectable({
  providedIn: 'root',
})
export class JobbappServ {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(Injector);

  async submitApplication(input: JobSubmission): Promise<{ trackingToken: string }> {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const trackingToken = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

    await runInInjectionContext(this.injector, () => {
      const application = doc(this.firestore, applicationCollection, trackingToken);
      const tracking = doc(this.firestore, trackingCollection, trackingToken);
      const notification = doc(collection(this.firestore, 'admin_notifications'));
      const notificationSource = doc(this.firestore, 'admin_notification_sources', notification.id);
      const batch = writeBatch(this.firestore);

      batch.set(application, {
        ...input,
        notificationId: notification.id,
        openingTitle: input.openingTitle ?? null,
        status: 'new',
        trackingEnabled: true,
        applicantNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      batch.set(tracking, {
        status: 'new',
        applicantNote: ''
      });

      batch.set(notification, {
        type: 'job_application',
        createdAt: serverTimestamp()
      });

      batch.set(notificationSource, {
        submissionId: application.id
      });

      return batch.commit();
    });

    return { trackingToken };
  }

  getTrackingStatus(token: string): Promise<JobTracking | null> {
    if (!trackingTokenPattern.test(token)) return Promise.resolve(null);

    return runInInjectionContext(this.injector, async () => {
      const snapshot = await getDocFromServer(doc(this.firestore, trackingCollection, token));
      const data = snapshot.data() as JobTracking | undefined;
      return data ? { status: data.status, applicantNote: data.applicantNote ?? '' } : null;
    });
  }

  watchApplications(
    onApplications: (applications: JobApplication[]) => void,
    onError: (error: FirestoreError) => void
  ): () => void {
    return runInInjectionContext(this.injector, () => onSnapshot(
      query(collection(this.firestore, applicationCollection), orderBy('createdAt', 'desc')),
      snapshot => onApplications(snapshot.docs.map(entry => ({
        ...entry.data(),
        id: entry.id
      }) as JobApplication)),
      onError
    ));
  }

  canManageOpenings(uid: string): Promise<boolean> {
    return runInInjectionContext(this.injector, async () => {
      const user = await getDocFromServer(doc(this.firestore, 'users', uid));
      return ['admin', 'administrator', 'staff'].includes(user.get('role'));
    });
  }

  watchOpenings(
    onOpenings: (openings: JobOpening[]) => void,
    onError: (error: FirestoreError) => void
  ): () => void {
    return runInInjectionContext(this.injector, () => onSnapshot(
      collection(this.firestore, openingCollection),
      snapshot => {
        const openings: JobOpening[] = [];

        for (const entry of snapshot.docs) {
          const title = entry.get('title');
          if (typeof title === 'string' && title.trim()) {
            openings.push({ id: entry.id, title: title.trim() });
          }
        }

        onOpenings(openings.sort((first, second) => first.title.localeCompare(second.title)));
      },
      onError
    ));
  }

  async addOpening(value: string): Promise<void> {
    const title = value.trim();
    if (!title || title.length > 160) {
      throw new JobUpdateError('Enter a job title of up to 160 characters.');
    }

    await runInInjectionContext(this.injector, () =>
      addDoc(collection(this.firestore, openingCollection), { title })
    );
  }

  removeOpening(id: string): Promise<void> {
    return runInInjectionContext(this.injector, () =>
      deleteDoc(doc(this.firestore, openingCollection, id))
    );
  }

  updateApplication(input: JobUpdate): Promise<boolean> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new JobUpdateError('Sign in to update an application.');

    const note = input.applicantNote?.trim();
    if (note !== undefined && note.length > 1000) {
      throw new JobUpdateError('The note must be 1,000 characters or fewer.');
    }

    return runInInjectionContext(this.injector, () => {
      const reference = doc(this.firestore, applicationCollection, input.applicationId);
      const tracking = doc(this.firestore, trackingCollection, input.applicationId);
      const updatedAt = serverTimestamp();

      return runTransaction(this.firestore, async transaction => {
        const current = (await transaction.get(reference)).data() as JobApplication | undefined;
        if (
          !current ||
          current.status !== input.expectedStatus ||
          !allowedJobActions[input.action].includes(current.status)
        ) {
          throw new JobUpdateError('This application changed. Review the latest details and try again.');
        }

        const status = nextStatus[input.action];
        const trackingEnabled = current.trackingEnabled === true;
        const priorNote = current.applicantNote ?? '';
        if (trackingEnabled && note !== undefined && priorNote !== input.expectedApplicantNote) {
          throw new JobUpdateError('The applicant note changed. Select the application again before saving.');
        }

        const applicantNote = note ?? priorNote;
        transaction.update(reference, {
          status,
          updatedBy: uid,
          updatedAt,
          ...(trackingEnabled ? { applicantNote } : {})
        });

        if (trackingEnabled) transaction.update(tracking, { status, applicantNote });
        return trackingEnabled;
      });
    });
  }
}