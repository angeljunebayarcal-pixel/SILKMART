import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Shopsilk } from './shopsilk';

describe('Shopsilk', () => {
  let component: Shopsilk;
  let fixture: ComponentFixture<Shopsilk>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Shopsilk],
    }).compileComponents();

    fixture = TestBed.createComponent(Shopsilk);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
