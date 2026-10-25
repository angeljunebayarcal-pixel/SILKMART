import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProfileAdm } from './profile-adm';

describe('ProfileAdm', () => {
  let component: ProfileAdm;
  let fixture: ComponentFixture<ProfileAdm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileAdm],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileAdm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
