import { Component } from '@angular/core';
import { ContentAdm } from './content-adm/content-adm';
import { TopbarAdm } from './topbar-adm/topbar-adm';

@Component({
  selector: 'app-home-adm',
  imports: [ TopbarAdm, ContentAdm ],
  templateUrl: './home-adm.html',
  styleUrl: './home-adm.scss',
})
export class HomeAdm {}
