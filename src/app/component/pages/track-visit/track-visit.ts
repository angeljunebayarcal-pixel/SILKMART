import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap, type Observable } from 'rxjs';
import { VisitServ, type VisitStatus, type VisitTracking } from '../../../services/visit.serv';

type TrackingState =
  | { kind: 'loading' | 'missing' | 'error' }
  | { kind: 'ready'; visit: VisitTracking };

@Component({
  selector: 'app-track-visit',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './track-visit.html',
  styleUrl: './track-visit.scss'
})
export class TrackVisit {
  private readonly route = inject(ActivatedRoute);
  private readonly visits = inject(VisitServ);

  readonly state = signal<TrackingState>({ kind: 'loading' });
  readonly statusLabels: Record<VisitStatus, string> = {
    new: 'Pending Review',
    confirmed: 'Confirmed',
    reschedule_proposed: 'New Schedule Proposed',
    declined: 'Declined',
    completed: 'Completed'
  };

  constructor() {
    this.route.paramMap.pipe(
      switchMap(params => this.load(params.get('token') ?? '')),
      takeUntilDestroyed()
    ).subscribe(state => this.state.set(state));
  }

  private load(token: string): Observable<TrackingState> {
    return of(token).pipe(
      switchMap(value => this.visits.getTrackingStatus(value)),
      map((visit): TrackingState => visit ? { kind: 'ready', visit } : { kind: 'missing' }),
      catchError(() => of<TrackingState>({ kind: 'error' })),
      startWith<TrackingState>({ kind: 'loading' })
    );
  }
}