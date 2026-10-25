import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CustOrder } from './cust-order';

describe('CustOrder', () => {
  let component: CustOrder;
  let fixture: ComponentFixture<CustOrder>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustOrder],
    }).compileComponents();

    fixture = TestBed.createComponent(CustOrder);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
