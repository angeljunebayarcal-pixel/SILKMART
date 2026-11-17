import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TrackJobapp } from './track-jobapp';

describe('TrackJobapp', () => {
  let component: TrackJobapp;
  let fixture: ComponentFixture<TrackJobapp>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrackJobapp],
    }).compileComponents();

    fixture = TestBed.createComponent(TrackJobapp);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
