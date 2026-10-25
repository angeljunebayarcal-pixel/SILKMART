import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Add2cart } from './add2cart';

describe('Add2cart', () => {
  let component: Add2cart;
  let fixture: ComponentFixture<Add2cart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Add2cart],
    }).compileComponents();

    fixture = TestBed.createComponent(Add2cart);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
