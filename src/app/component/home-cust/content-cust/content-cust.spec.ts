import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ContentCust } from './content-cust';

describe('ContentCust', () => {
  let component: ContentCust;
  let fixture: ComponentFixture<ContentCust>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContentCust],
    }).compileComponents();

    fixture = TestBed.createComponent(ContentCust);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
