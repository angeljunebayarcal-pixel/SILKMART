import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  Timestamp,
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type FirestoreError
} from '@angular/fire/firestore';

export interface VisitSubmission {
  fullName: string;
  email: string;
  organization: string;
  purpose: string;
  otherPurpose: string;
  preferredDateTime: string;
  visitorCount: number;
}

export type VisitStatus = 'new' | 'confirmed' | 'reschedule_proposed' | 'declined' | 'completed';

export interface VisitTracking {
  status: VisitStatus;
  preferredDateTime: string;
  scheduledDateTime: string | null;
  visitorNote: string;
}

export interface VisitRequest extends Omit<VisitSubmission, 'organization' | 'otherPurpose'> {
  id: string;
  organization?: string;
  otherPurpose?: string;
  scheduledDateTime?: string;
  internalNote?: string;
  visitorNote?: string;
  trackingEnabled?: boolean;
  location?: string;
  status: VisitStatus;
}

export type VisitAction = 'confirm' | 'propose' | 'decline' | 'complete' | 'save_note';

interface VisitUpdate {
  requestId: string;
  expectedStatus: VisitStatus;
  action: VisitAction;
  internalNote: string;
  expectedNote: string;
  expectedScheduledDateTime?: string;
  scheduledDateTime?: string;
  visitorNote?: string;
}

export class VisitUpdateError extends Error {}

const visitCollection = 'visit_requests';
const trackingCollection = 'visit_tracking';
const trackingTokenPattern = /^[a-f0-9]{64}$/;
const nextStatus = {
  confirm: 'confirmed',
  propose: 'reschedule_proposed',
  decline: 'declined',
  complete: 'completed'
} as const;

function visitDate(value: string | Timestamp): string {
  return typeof value === 'string' ? value : value.toDate().toISOString();
}

function createTrackingToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

@Injectable({
  providedIn: 'root',
})
export class VisitServ {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(Injector);

  submitRequest(input: VisitSubmission): Promise<{ trackingToken: string }> {
    return runInInjectionContext(this.injector, async () => {
      const trackingToken = createTrackingToken();
      const request = doc(this.firestore, visitCollection, trackingToken);
      const tracking = doc(this.firestore, trackingCollection, trackingToken);
      const notification = doc(collection(this.firestore, 'admin_notifications'));
      const notificationSource = doc(this.firestore, 'admin_notification_sources', notification.id);
      const preferredDateTime = Timestamp.fromDate(new Date(input.preferredDateTime));
      const batch = writeBatch(this.firestore);

      batch.set(request, {
        ...input,
        notificationId: notification.id,
        preferredDateTime,
        trackingEnabled: true,
        status: 'new',
        internalNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      batch.set(tracking, {
        status: 'new',
        preferredDateTime,
        scheduledDateTime: null,
        location: ''
      });

      batch.set(notification, {
        type: 'visit_request',
        createdAt: serverTimestamp()
      });

      batch.set(notificationSource, {
        submissionId: request.id
      });

      await batch.commit();
      return { trackingToken };
    });
  }

  getTrackingStatus(token: string): Promise<VisitTracking | null> {
    if (!trackingTokenPattern.test(token)) return Promise.resolve(null);

    return runInInjectionContext(this.injector, async () => {
      const snapshot = await getDocFromServer(doc(this.firestore, trackingCollection, token));
      const data = snapshot.data();
      if (!data) return null;

      return {
        status: data['status'] as VisitStatus,
        preferredDateTime: visitDate(data['preferredDateTime']),
        scheduledDateTime: data['scheduledDateTime'] ? visitDate(data['scheduledDateTime']) : null,
        visitorNote: data['visitorNote'] ?? ''
      };
    });
  }

  watchRequests(
    onRequests: (requests: VisitRequest[]) => void,
    onError: (error: FirestoreError) => void
  ): () => void {
    return runInInjectionContext(this.injector, () => onSnapshot(
      query(collection(this.firestore, visitCollection), orderBy('createdAt', 'desc')),
      snapshot => onRequests(snapshot.docs.map(snapshot => {
        const data = snapshot.data() as Omit<VisitRequest, 'id' | 'preferredDateTime' | 'scheduledDateTime'> & {
          preferredDateTime: string | Timestamp;
          scheduledDateTime?: string | Timestamp;
        };
        return {
          ...data,
          id: snapshot.id,
          preferredDateTime: visitDate(data.preferredDateTime),
          scheduledDateTime: data.scheduledDateTime ? visitDate(data.scheduledDateTime) : undefined
        };
      })),
      onError
    ));
  }

  async updateRequest(input: VisitUpdate): Promise<boolean> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new VisitUpdateError('Sign in to update a visit request.');

    const confirming = input.action === 'confirm';
    const scheduling = confirming || input.action === 'propose';
    const date = scheduling && input.scheduledDateTime
      ? new Date(input.scheduledDateTime)
      : null;
    if (scheduling && (!date || !(date.getTime() > Date.now()))) {
      throw new VisitUpdateError('Choose a future date and time.');
    }
    const schedule = date ? Timestamp.fromDate(date) : null;
    const visitorNote = scheduling ? input.visitorNote?.trim() : undefined;
    if (visitorNote !== undefined && visitorNote.length > 1000) {
      throw new VisitUpdateError('The note for the visitor must be 1,000 characters or fewer.');
    }

    return runInInjectionContext(this.injector, () => {
      const reference = doc(this.firestore, visitCollection, input.requestId);

      return runTransaction(this.firestore, async transaction => {
        const request = await transaction.get(reference);
        const savedSchedule = request.exists() ? request.get('scheduledDateTime') : undefined;
        const previousSchedule = savedSchedule ? visitDate(savedSchedule) : undefined;
        if (!request.exists() ||
            request.get('status') !== input.expectedStatus ||
            (request.get('internalNote') ?? '') !== input.expectedNote ||
            (scheduling && previousSchedule !== input.expectedScheduledDateTime)) {
          throw new VisitUpdateError('This request changed. Review the latest details and try again.');
        }

        const changedSchedule = scheduling && (
          confirming ||
          input.expectedStatus !== 'reschedule_proposed' ||
          previousSchedule !== date?.toISOString()
        );
        const status = input.action === 'save_note' ? input.expectedStatus : nextStatus[input.action];
        const trackingEnabled = request.get('trackingEnabled') === true;
        const previousVisitorNote: string = request.get('visitorNote') ?? '';
        const visitorNoteChanged = trackingEnabled && visitorNote !== undefined && visitorNote !== previousVisitorNote;
        const trackingChanged = status !== input.expectedStatus || changedSchedule || visitorNoteChanged;

        transaction.update(reference, {
          internalNote: input.internalNote,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
          ...(input.action === 'save_note' ? {} : { status: nextStatus[input.action] }),
          ...(changedSchedule ? { scheduledDateTime: schedule } : {}),
          ...(visitorNoteChanged ? { visitorNote } : {})
        });

        if (trackingEnabled && trackingChanged) {
          transaction.update(doc(this.firestore, trackingCollection, reference.id), {
            status,
            scheduledDateTime: status === 'declined'
              ? null
              : changedSchedule ? schedule : savedSchedule ?? null,
            location: '',
            visitorNote: status === 'declined' ? '' : visitorNote ?? previousVisitorNote
          });
          return true;
        }

        return false;
      });
    });
  }
}