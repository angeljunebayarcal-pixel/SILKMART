import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TopbarCust } from './topbar-cust';

describe('TopbarCust', () => {
  let component: TopbarCust;
  let fixture: ComponentFixture<TopbarCust>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopbarCust],
    }).compileComponents();

    fixture = TestBed.createComponent(TopbarCust);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
