import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NotfAdm } from './notf-adm';

describe('NotfAdm', () => {
  let component: NotfAdm;
  let fixture: ComponentFixture<NotfAdm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotfAdm],
    }).compileComponents();

    fixture = TestBed.createComponent(NotfAdm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
