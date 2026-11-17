import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Jobapp } from './jobapp';

describe('Jobapp', () => {
  let component: Jobapp;
  let fixture: ComponentFixture<Jobapp>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Jobapp],
    }).compileComponents();

    fixture = TestBed.createComponent(Jobapp);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
