import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Delivery } from './delivery';

describe('Delivery', () => {
  let component: Delivery;
  let fixture: ComponentFixture<Delivery>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Delivery],
    }).compileComponents();

    fixture = TestBed.createComponent(Delivery);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
