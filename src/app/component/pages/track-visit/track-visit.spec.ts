import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TrackVisit } from './track-visit';

describe('TrackVisit', () => {
  let component: TrackVisit;
  let fixture: ComponentFixture<TrackVisit>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrackVisit],
    }).compileComponents();

    fixture = TestBed.createComponent(TrackVisit);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
