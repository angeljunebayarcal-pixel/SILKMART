import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProfileCust } from './profile-cust';

describe('ProfileCust', () => {
  let component: ProfileCust;
  let fixture: ComponentFixture<ProfileCust>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileCust],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileCust);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
