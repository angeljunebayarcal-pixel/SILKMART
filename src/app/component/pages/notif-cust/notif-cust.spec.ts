import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NotifCust } from './notif-cust';

describe('NotifCust', () => {
  let component: NotifCust;
  let fixture: ComponentFixture<NotifCust>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotifCust],
    }).compileComponents();

    fixture = TestBed.createComponent(NotifCust);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
