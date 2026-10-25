import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ContentAdm } from './content-adm';

describe('ContentAdm', () => {
  let component: ContentAdm;
  let fixture: ComponentFixture<ContentAdm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContentAdm],
    }).compileComponents();

    fixture = TestBed.createComponent(ContentAdm);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
