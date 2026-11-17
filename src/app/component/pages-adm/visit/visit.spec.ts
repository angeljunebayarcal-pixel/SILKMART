import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Visit } from './visit';

describe('Visit', () => {
  let component: Visit;
  let fixture: ComponentFixture<Visit>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Visit],
    }).compileComponents();

    fixture = TestBed.createComponent(Visit);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
