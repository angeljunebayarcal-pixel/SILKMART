import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StfAprv } from './stf-aprv';

describe('StfAprv', () => {
  let component: StfAprv;
  let fixture: ComponentFixture<StfAprv>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StfAprv],
    }).compileComponents();

    fixture = TestBed.createComponent(StfAprv);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
