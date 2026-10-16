import { Routes } from '@angular/router';
import { Login } from './component/auth/login/login';
import { HomeCust } from './component/home-cust/home-cust';
import { Shopsilk } from './component/pages/shopsilk/shopsilk';
import { Order } from './component/pages/order/order';
import { ProfileCust } from './component/pages/profile-cust/profile-cust';
import { NotifCust } from './component/pages/notif-cust/notif-cust';

export const routes: Routes = [
  { path: '', component: Login },
  { path: 'login', component: Login },
  {
    path: 'home-cust',
    component: HomeCust,
    children: [

      { path: '', redirectTo: 'shopsilk', pathMatch: 'full' },
      { path: 'shopsilk', component: Shopsilk },
      { path: 'order', component: Order },
      { path: 'profile', component: ProfileCust },
      { path: 'notif-cust', component: NotifCust},

    ]
  }
];