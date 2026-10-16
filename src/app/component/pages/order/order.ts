import {
  CommonModule
} from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  Injector,
  OnDestroy,
  OnInit,
  runInInjectionContext
} from '@angular/core';

import {
  Router
} from '@angular/router';

import {
  Auth,
  onAuthStateChanged
} from '@angular/fire/auth';


interface SilkOrder {

  id?: number;

  userId?: string;

  name: string;

  category?: string;

  price: number;

  quantity: number;

  total: number;

  stock?: number;

  status: string;

  orderDate: string;

  artClass?: string;

  cancelReason?: string;

  cancelledDate?: string;

}


@Component({
  selector: 'app-order',

  standalone: true,

  imports: [
    CommonModule
  ],

  templateUrl: './order.html',

  styleUrl: './order.scss'
})
export class Order
  implements OnInit, OnDestroy {


  // =========================================
  // CURRENT USER
  // =========================================

  currentUserId = '';

  authResolved = false;


  private stopAuthListener:
    (() => void) | null = null;


  // =========================================
  // ORDERS
  // =========================================

  orders: SilkOrder[] = [];


  // =========================================
  // CANCEL ORDER POPUP
  // =========================================

  cancelOrderPopup = false;

  selectedOrder:
    SilkOrder | null = null;

  selectedCancelReason = '';


  // =========================================
  // DELETE ORDER POPUP
  // =========================================

  deleteOrderPopup = false;

  selectedDeleteOrder:
    SilkOrder | null = null;


  // =========================================
  // CANCELLATION REASONS
  // =========================================

  cancelReasons: string[] = [

    'I changed my mind',

    'I ordered by mistake',

    'I found another product',

    'The delivery time is too long',

    'I no longer need the item',

    'I want to change my order',

    'Other reason'

  ];


  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private router: Router,
    private auth: Auth,
    private injector: Injector,
    private cdr: ChangeDetectorRef
  ) {}


  // =========================================
  // PAGE LOAD
  // =========================================

  ngOnInit(): void {

    this.listenToAuthUser();

  }


  // =========================================
  // AUTH LISTENER
  // =========================================

  private listenToAuthUser(): void {

    this.stopAuthListener =
      runInInjectionContext(
        this.injector,

        () =>
          onAuthStateChanged(
            this.auth,

            user => {

              this.authResolved = true;


              // =====================================
              // GUEST / NOT SIGNED IN
              // =====================================

              if (!user) {

                this.currentUserId = '';

                this.orders = [];


                this.closeCancelPopup();

                this.closeDeletePopup();


                this.cdr.detectChanges();


                return;

              }


              // =====================================
              // SIGNED IN USER
              // =====================================

              this.currentUserId =
                user.uid;


              this.loadOrders();


              this.cdr.detectChanges();

            }
          )
      );

  }


  // =========================================
  // LOAD ORDERS
  // =========================================

  loadOrders(): void {

    if (!this.currentUserId) {

      this.orders = [];

      return;

    }


    const savedOrders =
      localStorage.getItem(
        'silkOrders'
      );


    if (!savedOrders) {

      this.orders = [];

      return;

    }


    try {

      const parsedOrders:
        SilkOrder[] =
        JSON.parse(
          savedOrders
        );


      if (!Array.isArray(parsedOrders)) {

        this.orders = [];

        return;

      }


      // =====================================
      // CURRENT CUSTOMER ONLY
      // + LATEST ORDER FIRST
      // =====================================

      this.orders =
        parsedOrders
          .filter(
            order =>
              order.userId ===
              this.currentUserId
          )
          .sort(
            (a, b) =>
              (b.id ?? 0) -
              (a.id ?? 0)
          );


    } catch {

      this.orders = [];

    }

  }


  // =========================================
  // OPEN CANCEL POPUP
  // =========================================

  openCancelPopup(
    order: SilkOrder
  ): void {

    if (!this.currentUserId) {

      return;

    }


    if (
      order.userId !==
      this.currentUserId
    ) {

      return;

    }


    if (
      order.status ===
      'Cancelled'
    ) {

      return;

    }


    this.selectedOrder =
      order;


    this.selectedCancelReason =
      '';


    this.cancelOrderPopup =
      true;

  }


  // =========================================
  // CLOSE CANCEL POPUP
  // =========================================

  closeCancelPopup(): void {

    this.cancelOrderPopup =
      false;


    this.selectedOrder =
      null;


    this.selectedCancelReason =
      '';

  }


  // =========================================
  // SELECT CANCEL REASON
  // =========================================

  selectCancelReason(
    reason: string
  ): void {

    this.selectedCancelReason =
      reason;

  }


  // =========================================
  // CONFIRM CANCELLATION
  // =========================================

  confirmCancellation(): void {

    if (
      !this.selectedOrder ||
      !this.currentUserId
    ) {

      return;

    }


    if (
      this.selectedOrder.userId !==
      this.currentUserId
    ) {

      return;

    }


    if (!this.selectedCancelReason) {

      alert(
        'Please select a reason for cancelling your order.'
      );

      return;

    }


    const savedOrders =
      localStorage.getItem(
        'silkOrders'
      );


    if (!savedOrders) {

      return;

    }


    try {

      const allOrders:
        SilkOrder[] =
        JSON.parse(
          savedOrders
        );


      if (!Array.isArray(allOrders)) {

        return;

      }


      const updatedOrders =
        allOrders.map(
          order => {

            if (
              order.id ===
                this.selectedOrder?.id
              &&
              order.userId ===
                this.currentUserId
            ) {

              return {

                ...order,

                status:
                  'Cancelled',

                cancelReason:
                  this.selectedCancelReason,

                cancelledDate:
                  new Date()
                    .toLocaleDateString()

              };

            }


            return order;

          }
        );


      localStorage.setItem(
        'silkOrders',
        JSON.stringify(
          updatedOrders
        )
      );


      this.loadOrders();


      this.closeCancelPopup();


      this.cdr.detectChanges();


    } catch {

      return;

    }

  }


  // =========================================
  // OPEN DELETE POPUP
  // =========================================

  deleteOrder(
    order: SilkOrder
  ): void {

    if (!this.currentUserId) {

      return;

    }


    if (
      order.userId !==
      this.currentUserId
    ) {

      return;

    }


    if (
      order.status !==
      'Cancelled'
    ) {

      return;

    }


    this.selectedDeleteOrder =
      order;


    this.deleteOrderPopup =
      true;

  }


  // =========================================
  // CLOSE DELETE POPUP
  // =========================================

  closeDeletePopup(): void {

    this.deleteOrderPopup =
      false;


    this.selectedDeleteOrder =
      null;

  }


  // =========================================
  // CONFIRM DELETE ORDER
  // =========================================

  confirmDeleteOrder(): void {

    if (
      !this.selectedDeleteOrder ||
      !this.currentUserId
    ) {

      return;

    }


    if (
      this.selectedDeleteOrder.userId !==
      this.currentUserId
    ) {

      return;

    }


    const savedOrders =
      localStorage.getItem(
        'silkOrders'
      );


    if (!savedOrders) {

      return;

    }


    try {

      const allOrders:
        SilkOrder[] =
        JSON.parse(
          savedOrders
        );


      if (!Array.isArray(allOrders)) {

        return;

      }


      const updatedOrders =
        allOrders.filter(
          order =>
            !(
              order.id ===
                this.selectedDeleteOrder?.id
              &&
              order.userId ===
                this.currentUserId
            )
        );


      localStorage.setItem(
        'silkOrders',
        JSON.stringify(
          updatedOrders
        )
      );


      this.loadOrders();


      this.closeDeletePopup();


      this.cdr.detectChanges();


    } catch {

      return;

    }

  }


  // =========================================
  // SHOP COLLECTION
  // =========================================

  shopCollection(): void {

    this.router.navigate([
      '/home-cust/shopsilk'
    ]);

  }


  // =========================================
  // TRACK ORDER
  // =========================================

  trackOrder(): void {

    console.log(
      'Track an order clicked'
    );

  }


  // =========================================
  // DESTROY
  // =========================================

  ngOnDestroy(): void {

    if (this.stopAuthListener) {

      this.stopAuthListener();

      this.stopAuthListener =
        null;

    }

  }

}