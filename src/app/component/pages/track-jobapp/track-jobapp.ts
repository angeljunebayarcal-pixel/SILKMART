import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, defer, map, of, startWith, switchMap, type Observable } from 'rxjs';
import { JobbappServ, type JobStatus, type JobTracking } from '../../../services/jobbapp.serv';

type TrackingState =
  | { kind: 'loading' | 'missing' | 'error' }
  | { kind: 'ready'; application: JobTracking };

@Component({
  selector: 'app-track-jobapp',
  imports: [RouterLink],
  templateUrl: './track-jobapp.html',
  styleUrl: './track-jobapp.scss',
})
export class TrackJobapp {
  private readonly route = inject(ActivatedRoute);
  private readonly applications = inject(JobbappServ);

  readonly state = signal<TrackingState>({ kind: 'loading' });
  readonly statusLabels: Record<JobStatus, string> = {
    new: 'Pending Review',
    under_review: 'Under Review',
    shortlisted: 'Shortlisted',
    confirmed: 'Confirmed',
    rejected: 'Rejected',
    closed: 'Closed'
  };

  constructor() {
    this.route.paramMap.pipe(
      switchMap(params => this.load(params.get('token') ?? '')),
      takeUntilDestroyed()
    ).subscribe(state => this.state.set(state));
  }

  private load(token: string): Observable<TrackingState> {
    return defer(() => this.applications.getTrackingStatus(token)).pipe(
      map((application): TrackingState => application
        ? { kind: 'ready', application }
        : { kind: 'missing' }),
      catchError(() => of<TrackingState>({ kind: 'error' })),
      startWith<TrackingState>({ kind: 'loading' })
    );
  }
}