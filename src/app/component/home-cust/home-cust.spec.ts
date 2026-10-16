import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeCust } from './home-cust';

describe('HomeCust', () => {
  let component: HomeCust;
  let fixture: ComponentFixture<HomeCust>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeCust],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeCust);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
