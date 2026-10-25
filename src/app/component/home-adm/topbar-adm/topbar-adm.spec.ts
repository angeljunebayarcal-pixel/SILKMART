import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TopbarAdm } from './topbar-adm';

describe('TopbarAdm', () => {
  let component: TopbarAdm;
  let fixture: ComponentFixture<TopbarAdm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopbarAdm],
    }).compileComponents();

    fixture = TestBed.createComponent(TopbarAdm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
