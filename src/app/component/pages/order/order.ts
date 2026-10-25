
import { CommonModule } from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  Injector,
  OnDestroy,
  OnInit,
  runInInjectionContext
} from '@angular/core';

import { Router } from '@angular/router';

import {
  Auth,
  onAuthStateChanged
} from '@angular/fire/auth';

import { Subscription } from 'rxjs';

import {
  OrderServ,
  SilkMartOrder
} from '../../../services/order.serv';

interface SilkOrder {
  id: string;
  userId: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  total: number;
  status: string;
  orderDate: string;
  artClass: string;
  cancelReason: string;
  preferredDeliveryDate: string;
  products: string[];
}

@Component({
  selector: 'app-order',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './order.html',
  styleUrl: './order.scss'
})
export class Order implements OnInit, OnDestroy {

  currentUserId = '';
  authResolved = false;

  orders: SilkOrder[] = [];

  loadingOrders = true;
  orderError = '';

  saving = false;

  // =========================================
  // CANCELLATION POPUP
  // =========================================

  cancelOrderPopup = false;
  selectedOrder: SilkOrder | null = null;
  selectedCancelReason = '';

  // =========================================
  // PERMANENT DELETE POPUP
  // =========================================

  deleteOrderPopup = false;
  selectedDeleteOrder: SilkOrder | null = null;
  deletingOrder = false;

  cancelReasons: string[] = [
    'I changed my mind',
    'I ordered by mistake',
    'I found another product',
    'The delivery time is too long',
    'I no longer need the item',
    'I want to change my order',
    'Other reason'
  ];

  private stopAuthListener: (() => void) | null = null;
  private ordersSubscription: Subscription | null = null;

  constructor(
    private router: Router,
    private auth: Auth,
    private injector: Injector,
    private cdr: ChangeDetectorRef,
    private orderService: OrderServ
  ) {}

  // =========================================
  // PAGE INITIALIZATION
  // =========================================

  ngOnInit(): void {
    this.listenToAuthUser();
  }

  private listenToAuthUser(): void {
    this.stopAuthListener = runInInjectionContext(
      this.injector,
      () => onAuthStateChanged(
        this.auth,

        user => {
          this.ordersSubscription?.unsubscribe();
          this.ordersSubscription = null;

          this.authResolved = true;

          if (!user) {
            this.currentUserId = '';
            this.orders = [];
            this.loadingOrders = false;
            this.orderError = '';

            this.closeCancelPopup();
            this.closeDeletePopup();

            this.cdr.detectChanges();
            return;
          }

          this.currentUserId = user.uid;
          this.orders = [];
          this.loadingOrders = true;
          this.orderError = '';

          this.loadOrders();
          this.cdr.detectChanges();
        },

        error => {
          console.error(
            'Authentication error:',
            error
          );

          this.authResolved = true;
          this.loadingOrders = false;
          this.orderError =
            'Unable to verify your account.';

          this.cdr.detectChanges();
        }
      )
    );
  }

  // =========================================
  // FIRESTORE REAL-TIME ORDER LISTENER
  // =========================================

  loadOrders(): void {
    if (!this.currentUserId) {
      this.orders = [];
      this.loadingOrders = false;
      return;
    }

    this.ordersSubscription?.unsubscribe();

    this.loadingOrders = true;
    this.orderError = '';

    this.ordersSubscription = runInInjectionContext(
      this.injector,
      () => this.orderService.getMyOrders()
        .subscribe({
          next: (firebaseOrders: SilkMartOrder[]) => {
            this.orders = firebaseOrders
              .filter(
                order =>
                  order.customerId === this.currentUserId
              )
              .map(
                order => this.convertFirestoreOrder(order)
              );

            this.loadingOrders = false;
            this.orderError = '';

            this.cdr.detectChanges();
          },

          error: error => {
            console.error(
              'Firestore orders error:',
              error
            );

            this.loadingOrders = false;

            this.orderError =
              error?.code === 'permission-denied'
                ? 'Firebase denied access to your orders.'
                : 'Unable to load orders. Check your connection.';

            this.cdr.detectChanges();
          }
        })
    );
  }

  // =========================================
  // FORMAT FIRESTORE DATA FOR CURRENT DESIGN
  // =========================================

  private convertFirestoreOrder(
    order: SilkMartOrder
  ): SilkOrder {
    const items = Array.isArray(order.items)
      ? order.items
      : [];

    const firstProduct = items[0];

    const quantity = items.reduce(
      (total, item) =>
        total + Number(item.quantity || 0),
      0
    );

    const productNames = items
      .map(item => item.name)
      .filter(Boolean);

    let name = firstProduct?.name || 'Silk Product';

    if (items.length > 1) {
      name += ` + ${items.length - 1} more`;
    }

    return {
      id: String(order.id),
      userId: order.customerId,
      name,
      category:
        firstProduct?.category ||
        'SILK COLLECTION',
      price: Number(
        firstProduct?.price ?? 0
      ),
      quantity,
      total: Number(order.total ?? 0),
      status: order.status || 'Pending',
      orderDate: this.formatOrderDate(
        order.createdAt
      ),
      artClass:
        firstProduct?.artClass ||
        'scarf-art',
      cancelReason:
        order.cancelReason || '',
      preferredDeliveryDate:
        order.preferredDeliveryDate || '',
      products: productNames
    };
  }

  private formatOrderDate(value: any): string {
    if (!value) return 'Just now';

    let date: Date;

    if (typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (typeof value.seconds === 'number') {
      date = new Date(value.seconds * 1000);
    } else {
      date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) {
      return 'Just now';
    }

    return date.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // =========================================
  // OPEN CANCEL POPUP
  // =========================================

  openCancelPopup(order: SilkOrder): void {
    if (
      !this.currentUserId ||
      order.userId !== this.currentUserId
    ) {
      return;
    }

    if (order.status !== 'Pending') {
      alert(
        'Only pending orders can be cancelled.'
      );
      return;
    }

    this.selectedOrder = order;
    this.selectedCancelReason = '';
    this.cancelOrderPopup = true;
  }

  closeCancelPopup(): void {
    if (this.saving) return;

    this.cancelOrderPopup = false;
    this.selectedOrder = null;
    this.selectedCancelReason = '';
  }

  selectCancelReason(reason: string): void {
    this.selectedCancelReason = reason;
  }

  // =========================================
  // CANCEL ORDER IN FIRESTORE
  // =========================================

  async confirmCancellation(): Promise<void> {
    if (
      this.saving ||
      !this.selectedOrder ||
      !this.currentUserId
    ) {
      return;
    }

    if (
      this.selectedOrder.userId !== this.currentUserId
    ) {
      return;
    }

    if (!this.selectedCancelReason) {
      alert(
        'Please select a cancellation reason.'
      );
      return;
    }

    this.saving = true;

    try {
      await this.orderService.cancelMyOrder(
        this.selectedOrder.id,
        this.selectedCancelReason
      );

      this.saving = false;
      this.closeCancelPopup();

      // Real-time Firestore listener refreshes the status.
    } catch (error: any) {
      console.error(
        'Order cancellation failed:',
        error
      );

      alert(
        error?.message ||
        'Unable to cancel this order.'
      );

      this.saving = false;
    }

    this.cdr.detectChanges();
  }

  // =========================================
  // OPEN DELETE POPUP
  // =========================================

  deleteOrder(order: SilkOrder): void {
    if (
      !this.currentUserId ||
      order.userId !== this.currentUserId
    ) {
      return;
    }

    if (order.status !== 'Cancelled') {
      alert(
        'Only cancelled orders can be deleted.'
      );
      return;
    }

    this.selectedDeleteOrder = order;
    this.deleteOrderPopup = true;
  }

  // =========================================
  // CLOSE DELETE POPUP
  // =========================================

  closeDeletePopup(): void {
    if (this.deletingOrder) return;

    this.deleteOrderPopup = false;
    this.selectedDeleteOrder = null;
  }

  // =========================================
  // PERMANENTLY DELETE FIRESTORE ORDER
  // =========================================

  async confirmDeleteOrder(): Promise<void> {
    if (
      this.deletingOrder ||
      !this.selectedDeleteOrder ||
      !this.currentUserId
    ) {
      return;
    }

    const order = this.selectedDeleteOrder;

    if (order.userId !== this.currentUserId) {
      return;
    }

    if (order.status !== 'Cancelled') {
      alert(
        'Only cancelled orders can be deleted permanently.'
      );
      return;
    }

    this.deletingOrder = true;
    this.cdr.detectChanges();

    try {
      // Permanently removes the actual
      // orders/{orderId} Firestore document.

      await this.orderService.deleteMyCancelledOrder(
        order.id
      );

      // Update the screen immediately.
      // The Firestore listener also receives
      // the deletion automatically.

      this.orders = this.orders.filter(
        item => item.id !== order.id
      );

      this.deletingOrder = false;
      this.closeDeletePopup();

    } catch (error: any) {
      console.error(
        'Permanent deletion failed:',
        error
      );

      if (error?.code === 'permission-denied') {
        alert(
          'Firebase denied the deletion. Check the Firestore delete rule.'
        );
      } else {
        alert(
          error?.message ||
          'Unable to permanently delete this order.'
        );
      }

      this.deletingOrder = false;
    }

    this.cdr.detectChanges();
  }

  // =========================================
  // NAVIGATION
  // =========================================

  shopCollection(): void {
    this.router.navigate([
      '/home-cust/shopsilk'
    ]);
  }

  trackOrder(): void {
    if (this.currentUserId) {
      this.loadOrders();
    } else {
      this.router.navigate(['/login']);
    }
  }

  // =========================================
  // CLEANUP
  // =========================================

  ngOnDestroy(): void {
    this.ordersSubscription?.unsubscribe();
    this.ordersSubscription = null;

    this.stopAuthListener?.();
    this.stopAuthListener = null;
  }
}
