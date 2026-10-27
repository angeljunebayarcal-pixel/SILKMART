import { Routes } from '@angular/router';
import { Login } from './component/auth/login/login';
import { HomeCust } from './component/home-cust/home-cust';
import { Shopsilk } from './component/pages/shopsilk/shopsilk';
import { Order } from './component/pages/order/order';
import { ProfileCust } from './component/pages/profile-cust/profile-cust';
import { NotifCust } from './component/pages/notif-cust/notif-cust';
import { Add2cart } from './component/pages/add2cart/add2cart';
import { HomeAdm } from './component/home-adm/home-adm';
import { Inventory } from './component/pages-adm/inventory/inventory';
import { CustOrder } from './component/pages-adm/cust-order/cust-order';
import { Products } from './component/pages-adm/products/products';
import { ProfileAdm } from './component/pages-adm/profile-adm/profile-adm';
import { Delivery } from './component/pages-adm/delivery/delivery';
import { NotfAdm } from './component/pages-adm/notf-adm/notf-adm';
import { StfAprv } from './component/pages-adm/stf-aprv/stf-aprv';

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
      { path: 'add2cart', component: Add2cart },

    ]
  },

  {
    path: 'home-adm',
    component: HomeAdm,
    children: [
      { path: '', redirectTo: 'inventory', pathMatch: 'full' },
      { path: 'inventory', component: Inventory },
      { path: 'cust-order', component: CustOrder },
      { path: 'products', component: Products },
      { path: 'profile-adm', component: ProfileAdm },
      { path: 'delivery', component: Delivery },
      { path: 'notf-adm', component: NotfAdm },
      { path: 'stf-aprv', component: StfAprv },



    ]
  }
];