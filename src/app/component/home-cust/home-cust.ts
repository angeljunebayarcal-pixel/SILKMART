import { Component } from '@angular/core';
import { ContentCust } from './content-cust/content-cust';
import { TopbarCust } from './topbar-cust/topbar-cust';
import { RouterOutlet } from '../../../../node_modules/@angular/router/types/_router_module-chunk';

@Component({
  selector: 'app-home-cust',
  imports: [TopbarCust, ContentCust],
  templateUrl: './home-cust.html',
  styleUrl: './home-cust.scss',
})
export class HomeCust {}
