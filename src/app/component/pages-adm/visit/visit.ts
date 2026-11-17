import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { VisitServ, VisitUpdateError, type VisitAction, type VisitRequest, type VisitStatus } from '../../../services/visit.serv';

const statuses = {
  new: 'New',
  confirmed: 'Confirmed',
  reschedule_proposed: 'Reschedule proposed',
  declined: 'Declined',
  completed: 'Completed'
} as const;

type VisitDecision = Exclude<VisitAction, 'save_note'>;

@Component({
  selector: 'app-visit',
  imports: [DatePipe, FormsModule],
  templateUrl: './visit.html',
  styleUrl: './visit.scss',
})
export class Visit {
  private readonly auth = inject(Auth);
  private readonly visitService = inject(VisitServ);
  private readonly destroyRef = inject(DestroyRef);
  private selectedId = inject(ActivatedRoute).snapshot.queryParamMap.get('id');
  private stopRequests?: () => void;
  private activeUid: string | null = null;
  private session = 0;

  readonly statuses = statuses;
  readonly filters = Object.keys(statuses) as VisitStatus[];
  private readonly cards = [
    { status: 'new', label: 'New requests', icon: 'pi-users' },
    { status: 'confirmed', label: 'Confirmed', icon: 'pi-calendar' },
    { status: 'reschedule_proposed', label: 'Reschedule proposed', icon: 'pi-clock' }
  ] as const;

  readonly requests = signal<VisitRequest[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly feedback = signal('');
  readonly actionError = signal('');

  search = '';
  filter: VisitStatus | 'all' = 'all';
  selected: VisitRequest | null = null;
  detailsOpen = false;
  action: VisitDecision | null = null;
  schedule = '';
  visitorNote = '';

  constructor() {
    const stopAuth = onAuthStateChanged(this.auth, user => {
      if (this.activeUid !== user?.uid && this.activeUid !== null) {
        this.session++;
        this.selectedId = null;
        this.saving.set(false);
        this.clearDetail();
      }
      this.activeUid = user?.uid ?? null;
      this.load();
    });

    this.destroyRef.onDestroy(() => {
      this.session++;
      stopAuth();
      this.stopRequests?.();
    });
  }

  get summary() {
    const requests = this.requests();
    return this.cards.map(card => ({
      ...card,
      count: requests.filter(request => request.status === card.status).length
    }));
  }

  get filteredRequests(): VisitRequest[] {
    const search = this.search.trim().toLowerCase();
    return this.requests().filter(request =>
      (this.filter === 'all' || request.status === this.filter) &&
      [request.fullName, request.email, request.organization, request.purpose, request.otherPurpose]
        .some(value => value?.toLowerCase().includes(search))
    );
  }

  setFilter(filter: VisitStatus | 'all'): void {
    this.filter = filter;
    this.selectVisibleRequest();
  }

  setSearch(search: string): void {
    this.search = search;
    this.selectVisibleRequest();
  }

  private selectVisibleRequest(): void {
    const requests = this.filteredRequests;
    if (requests.some(request => request.id === this.selected?.id)) return;
    if (requests[0]) {
      this.select(requests[0]);
    } else {
      this.selectedId = null;
      this.clearDetail();
    }
  }

  load(): void {
    this.stopRequests?.();
    this.requests.set([]);
    this.error.set('');

    if (!this.activeUid) {
      this.loading.set(false);
      this.clearDetail();
      this.error.set('Sign in with an Admin or Staff account to view visit requests.');
      return;
    }

    this.loading.set(true);
    this.stopRequests = this.visitService.watchRequests(
      requests => {
        this.requests.set(requests);
        const visible = this.filteredRequests;
        const selected = visible.find(request => request.id === this.selectedId) ?? visible[0];
        if (selected?.id === this.selected?.id) {
          this.selected = selected ?? null;
        } else if (selected) {
          this.select(selected);
        } else {
          this.clearDetail();
        }
        this.loading.set(false);
      },
      error => {
        this.requests.set([]);
        this.clearDetail();
        this.loading.set(false);
        this.error.set(error.code === 'permission-denied'
          ? 'Your account cannot access visit requests. Check the Firestore rules for this page.'
          : 'Visit requests could not be loaded. Try again.');
      }
    );
  }

  select(request: VisitRequest): void {
    if (this.selected?.id !== request.id) this.detailsOpen = false;
    this.selected = request;
    this.selectedId = request.id;
    this.action = null;
    this.feedback.set('');
    this.actionError.set('');
  }

  toggleDetails(request: VisitRequest, panel: HTMLElement): void {
    if (this.selected?.id === request.id && this.detailsOpen) {
      this.detailsOpen = false;
      return;
    }

    if (this.selected?.id !== request.id) this.select(request);
    this.detailsOpen = true;
    panel.focus();
  }

  startAction(action: VisitDecision): void {
    this.action = action;
    this.feedback.set('');
    this.actionError.set('');
    this.visitorNote = this.selected?.visitorNote ?? '';
    const iso = this.selected?.scheduledDateTime || this.selected?.preferredDateTime;
    const date = iso ? new Date(iso) : null;
    this.schedule = date && Number.isFinite(date.getTime()) && date.getTime() > Date.now()
      ? new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
      : '';
  }

  cancelAction(): void {
    this.action = null;
    this.actionError.set('');
  }

  async save(action: VisitDecision): Promise<void> {
    const request = this.selected;
    const session = this.session;
    if (!request || !this.activeUid || this.saving()) return;

    this.feedback.set('');
    this.actionError.set('');
    const hasSchedule = action === 'confirm' || action === 'propose';
    const date = hasSchedule && this.schedule ? new Date(this.schedule + '+08:00') : null;
    if (hasSchedule && (!date || !(date.getTime() > Date.now()))) {
      this.actionError.set('Choose a future date and time.');
      return;
    }

    this.saving.set(true);
    try {
      const trackingUpdated = await this.visitService.updateRequest({
        requestId: request.id,
        expectedStatus: request.status,
        expectedScheduledDateTime: request.scheduledDateTime,
        action,
        internalNote: request.internalNote ?? '',
        expectedNote: request.internalNote ?? '',
        ...(date ? { scheduledDateTime: date.toISOString() } : {}),
        ...(hasSchedule && request.trackingEnabled ? { visitorNote: this.visitorNote.trim() } : {})
      });

      if (this.session !== session || this.selected?.id !== request.id) return;
      this.action = null;
      this.feedback.set(trackingUpdated
        ? 'Visit request saved. The tracking page has been updated.'
        : 'Visit request updated.');
    } catch (error) {
      if (this.session === session && this.selected?.id === request.id) {
        this.actionError.set(error instanceof VisitUpdateError
          ? error.message
          : 'Could not save the update. Check the current status before retrying.');
      }
    } finally {
      if (this.session === session) this.saving.set(false);
    }
  }

  private clearDetail(): void {
    this.selected = null;
    this.detailsOpen = false;
    this.action = null;
    this.feedback.set('');
    this.actionError.set('');
  }
}