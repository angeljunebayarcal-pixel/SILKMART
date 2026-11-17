import { formatDate } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  JobbappServ,
  JobUpdateError,
  allowedJobActions,
  type JobAction,
  type JobApplication,
  type JobOpening,
  type JobStatus
} from '../../../services/jobbapp.serv';

const statuses = {
  new: 'New',
  under_review: 'Under Review',
  shortlisted: 'Shortlisted',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  closed: 'Closed'
} as const;

@Component({
  selector: 'app-jobapp',
  imports: [FormsModule],
  templateUrl: './jobapp.html',
  styleUrl: './jobapp.scss',
})
export class Jobapp {
  private readonly auth = inject(Auth);
  private readonly jobs = inject(JobbappServ);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly selectedId = signal<string | null>(null);
  private stopApplications?: () => void;
  private stopOpenings?: () => void;
  private uid: string | null = null;
  private listenerVersion = 0;
  private session = 0;

  readonly statuses = statuses;
  readonly statusOptions = ['new', 'under_review', 'confirmed', 'rejected', 'closed'] as const;
  readonly applications = signal<JobApplication[]>([]);
  readonly search = signal('');
  readonly filter = signal<JobStatus | 'all'>('all');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly actionError = signal('');
  readonly feedback = signal('');
  readonly canManageOpenings = signal(false);
  readonly openings = signal<JobOpening[]>([]);
  readonly openingsLoading = signal(true);
  readonly openingsSaving = signal(false);
  readonly openingsError = signal('');
  readonly openingsFeedback = signal('');

  readonly openingPreviewLimit = 2;
  readonly showAllOpenings = signal(false);
  readonly visibleOpenings = computed(() => {
    const openings = this.openings();
    return this.showAllOpenings() ? openings : openings.slice(0, this.openingPreviewLimit);
  });
  readonly showApplicationDetails = signal(false);

  readonly filteredApplications = computed(() => {
    const search = this.search().trim().toLowerCase();
    const filter = this.filter();

    return this.applications().filter(application =>
      (filter === 'all' || application.status === filter) &&
      [application.fullName, application.email, this.position(application)]
        .some(value => (value ?? '').toLowerCase().includes(search))
    );
  });

  readonly selected = computed(() =>
    this.filteredApplications().find(application => application.id === this.selectedId()) ?? null
  );

  readonly summary = computed(() => {
    const cards = [
      { status: 'new', label: 'New applications', icon: 'pi-file' },
      { status: 'under_review', label: 'Under review', icon: 'pi-search' },
      { status: 'confirmed', label: 'Confirmed', icon: 'pi-check-circle' }
    ] as const;
    const applications = this.applications();

    return cards.map(card => ({
      ...card,
      count: applications.filter(application => application.status === card.status).length
    }));
  });

  applicantNote = '';
  confirmingClose = false;
  openingTitle = '';
  private originalApplicantNote = '';

  constructor() {
    const routeSubscription = this.route.queryParamMap.subscribe(params => {
      const id = params.get('id');
      if (!id) return;

      this.filter.set('all');
      this.search.set('');
      this.selectedId.set(id);

      if (!this.loading()) {
        this.select(this.selected() ?? this.filteredApplications()[0]);
      }
    });

    const stopAuth = onAuthStateChanged(this.auth, user => {
      const uid = user?.uid ?? null;

      if (this.uid && this.uid !== uid) {
        this.session++;
        this.select(undefined);
        this.saving.set(false);
        this.openingsSaving.set(false);
        this.openingTitle = '';
      }

      this.uid = uid;
      this.load();
      void this.loadOpeningAccess(uid);
    });

    this.destroyRef.onDestroy(() => {
      this.session++;
      this.listenerVersion++;
      routeSubscription.unsubscribe();
      stopAuth();
      this.stopApplications?.();
      this.stopOpenings?.();
    });
  }

  private async loadOpeningAccess(uid: string | null): Promise<void> {
    this.canManageOpenings.set(false);
    this.showAllOpenings.set(false);
    this.stopOpenings?.();
    this.openings.set([]);
    if (!uid) return;

    const session = this.session;
    try {
      const allowed = await this.jobs.canManageOpenings(uid);
      if (this.session !== session || this.uid !== uid || !allowed) return;

      this.canManageOpenings.set(true);
      this.loadOpenings();
    } catch {
      // Access is checked again when the auth session changes.
    }
  }

  load(): void {
    this.stopApplications?.();
    const version = ++this.listenerVersion;
    this.error.set('');
    this.applications.set([]);
    this.loading.set(!!this.uid);

    if (!this.uid) {
      this.select(undefined);
      this.error.set('Sign in with an authorized account to view job applications.');
      return;
    }

    this.stopApplications = this.jobs.watchApplications(
      applications => {
        if (version !== this.listenerVersion) return;

        const previous = this.selected();
        this.applications.set(applications);
        const application = this.selected() ?? this.filteredApplications()[0];

        if (this.loading() || application?.id !== previous?.id) {
          this.select(application);
        } else if (application) {
          const savedApplicantNote = application.applicantNote ?? '';
          if (
            this.applicantNote === this.originalApplicantNote ||
            this.applicantNote === savedApplicantNote
          ) {
            this.applicantNote = this.originalApplicantNote = savedApplicantNote;
          }
        }

        this.loading.set(false);
      },
      error => {
        if (version !== this.listenerVersion) return;

        this.applications.set([]);
        this.select(undefined);
        this.loading.set(false);
        this.error.set(error.code === 'permission-denied'
          ? 'Your account cannot access job applications.'
          : 'Job applications could not be loaded. Try again.');
      }
    );
  }

  loadOpenings(): void {
    this.stopOpenings?.();
    this.openings.set([]);
    this.openingsError.set('');
    this.openingsFeedback.set('');
    this.openingsLoading.set(!!this.uid);

    if (!this.canManageOpenings()) return;

    this.stopOpenings = this.jobs.watchOpenings(
      openings => {
        this.openings.set(openings);
        if (openings.length <= this.openingPreviewLimit) this.showAllOpenings.set(false);
        this.openingsLoading.set(false);
      },
      () => {
        this.openingsLoading.set(false);
        this.openingsError.set('Available positions could not be loaded.');
      }
    );
  }

  addOpening(): Promise<void> {
    const title = this.openingTitle.trim();
    if (!title) return Promise.resolve();

    return this.saveOpening(() => this.jobs.addOpening(title), 'Position published.', true);
  }

  removeOpening(opening: JobOpening): Promise<void> {
    return this.saveOpening(() => this.jobs.removeOpening(opening.id), 'Position removed.');
  }

  private async saveOpening(
    change: () => Promise<void>,
    message: string,
    clearTitle = false
  ): Promise<void> {
    if (!this.canManageOpenings() || this.openingsSaving()) return;

    const session = this.session;
    this.openingsSaving.set(true);
    this.openingsError.set('');
    this.openingsFeedback.set('');

    try {
      await change();
      if (session !== this.session) return;

      if (clearTitle) this.openingTitle = '';
      this.openingsFeedback.set(message);
    } catch (error) {
      if (session === this.session) {
        this.openingsError.set(error instanceof JobUpdateError
          ? error.message
          : 'Could not save the change. Check your access and try again.');
      }
    } finally {
      if (session === this.session) this.openingsSaving.set(false);
    }
  }

  canApply(action: JobAction, application: JobApplication): boolean {
    return allowedJobActions[action].includes(application.status);
  }

  setFilter(filter: JobStatus | 'all'): void {
    this.filter.set(filter);
    if (!this.selected()) this.select(this.filteredApplications()[0]);
  }

  setSearch(search: string): void {
    this.search.set(search);
    if (!this.selected()) this.select(this.filteredApplications()[0]);
  }

  select(application?: JobApplication): void {
    this.showApplicationDetails.set(false);
    this.selectedId.set(application?.id ?? null);
    this.applicantNote = this.originalApplicantNote = application?.applicantNote ?? '';
    this.confirmingClose = false;
    this.actionError.set('');
    this.feedback.set('');
  }

  position(application: JobApplication): string {
    return application.openingTitle?.trim() || 'General Application';
  }

  appliedDate(application: JobApplication): string {
    const date = application.createdAt?.toDate();
    return date ? formatDate(date, 'MMM d, y', 'en-US', '+0800') : '—';
  }

  openPdf(application: JobApplication): void {
    this.actionError.set('');

    const resume = application.resumeFile;
    const prefix = 'data:application/pdf;base64,';
    const maxBytes = 700 * 1024;

    if (
      !resume || resume.contentType !== 'application/pdf' ||
      typeof resume.base64 !== 'string' || !resume.base64.startsWith(prefix) ||
      resume.base64.length > prefix.length + 4 * Math.ceil(maxBytes / 3)
    ) {
      this.actionError.set('The résumé PDF is unavailable.');
      return;
    }

    try {
      const raw = atob(resume.base64.slice(prefix.length));

      if (!raw.startsWith('%PDF-') || raw.length !== resume.size || raw.length > maxBytes) {
        throw new Error('Invalid PDF');
      }

      const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a');

      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      link.click();
    } catch {
      this.actionError.set('The résumé PDF could not be opened.');
    }
  }

  async save(action: JobAction): Promise<void> {
    const application = this.selected();
    const session = this.session;

    if (
      !application ||
      !this.uid ||
      this.saving() ||
      !this.canApply(action, application)
    ) return;

    this.saving.set(true);
    this.feedback.set('');
    this.actionError.set('');

    try {
      const trackingUpdated = await this.jobs.updateApplication({
        applicationId: application.id,
        expectedStatus: application.status,
        action,
        ...(application.trackingEnabled ? {
          applicantNote: this.applicantNote.trim(),
          expectedApplicantNote: this.originalApplicantNote
        } : {})
      });

      if (this.session !== session) return;

      this.confirmingClose = false;
      this.feedback.set(trackingUpdated
        ? 'Application status and tracking page updated.'
        : 'Application status updated.');
    } catch (error) {
      if (this.session === session && this.selected()?.id === application.id) {
        this.actionError.set(error instanceof JobUpdateError
          ? error.message
          : 'Could not confirm the update. Check the latest application details before retrying.');
      }
    } finally {
      if (this.session === session) this.saving.set(false);
    }
  }
}