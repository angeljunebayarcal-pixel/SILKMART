
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
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch
} from '@angular/fire/firestore';
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
  imageUrl: string;
  cancelReason: string;
  preferredDeliveryDate: string;
  products: string[];
  stockDeducted: boolean;
  stockRestored: boolean;
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
  deletingOrder = false;

  cancelOrderPopup = false;
  selectedOrder: SilkOrder | null = null;
  selectedCancelReason = '';

  deleteOrderPopup = false;
  selectedDeleteOrder: SilkOrder | null = null;

  readonly cancelReasons: string[] = [
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

  private session = 0;
  private destroyed = false;

  private readonly deletedOrderIds = new Set<string>();

  constructor(
    private router: Router,
    private auth: Auth,
    private injector: Injector,
    private cdr: ChangeDetectorRef,
    private orderService: OrderServ,
    private firestore: Firestore
  ) {}

  // =========================================
  // INITIALIZATION
  // =========================================

  ngOnInit(): void {
    this.destroyed = false;
    this.listenToAuthUser();
  }

  private refresh(): void {
    if (!this.destroyed) {
      this.cdr.detectChanges();
    }
  }

  private listenToAuthUser(): void {
    this.stopAuthListener = runInInjectionContext(
      this.injector,
      () => onAuthStateChanged(
        this.auth,
        user => {
          this.session++;

          this.ordersSubscription?.unsubscribe();
          this.ordersSubscription = null;

          this.authResolved = true;

          this.cancelOrderPopup = false;
          this.selectedOrder = null;
          this.selectedCancelReason = '';

          this.deleteOrderPopup = false;
          this.selectedDeleteOrder = null;

          const nextUid = user?.uid ?? '';

          if (nextUid !== this.currentUserId) {
            this.deletedOrderIds.clear();
          }

          if (!user) {
            this.currentUserId = '';
            this.orders = [];
            this.loadingOrders = false;
            this.orderError = '';
            this.refresh();
            return;
          }

          this.currentUserId = user.uid;
          this.orders = [];
          this.loadingOrders = true;
          this.orderError = '';

          this.loadOrders();
          this.refresh();
        },
        error => {
          console.error(
            'Authentication error:',
            error
          );

          this.session++;
          this.authResolved = true;
          this.loadingOrders = false;
          this.orderError =
            'Unable to verify your account.';

          this.refresh();
        }
      )
    );
  }

  // =========================================
  // LOAD CUSTOMER ORDERS
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

    const uid = this.currentUserId;
    const session = this.session;

    this.ordersSubscription = runInInjectionContext(
      this.injector,
      () => this.orderService.getMyOrders().subscribe({
        next: (firebaseOrders: SilkMartOrder[]) => {
          if (
            this.destroyed ||
            session !== this.session ||
            uid !== this.currentUserId
          ) {
            return;
          }

          this.orders = firebaseOrders
            .filter(order =>
              order.customerId === uid &&
              !this.deletedOrderIds.has(String(order.id))
            )
            .map(order =>
              this.convertFirestoreOrder(order)
            );

          this.synchronizePopups();

          this.loadingOrders = false;
          this.orderError = '';

          this.refresh();
        },

        error: error => {
          if (
            this.destroyed ||
            session !== this.session
          ) {
            return;
          }

          console.error(
            'Firestore orders error:',
            error
          );

          this.loadingOrders = false;

          this.orderError =
            error?.code === 'permission-denied'
              ? 'Firebase denied access to your orders.'
              : 'Unable to load orders. Check your connection.';

          this.refresh();
        }
      })
    );
  }

  // =========================================
  // CONVERT FIRESTORE ORDER
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
      .map(item => String(item.name || ''))
      .filter(Boolean);

    let name = firstProduct?.name || 'Silk Product';

    if (items.length > 1) {
      name += ` + ${items.length - 1} more`;
    }

    const firstImage = firstProduct as any;

    const imageUrl = String(
      firstImage?.image ||
      firstImage?.imageUrl ||
      ''
    );

    return {
      id: String(order.id),
      userId: String(order.customerId || ''),
      name,
      category:
        firstProduct?.category ||
        'SILK COLLECTION',
      price: Number(firstProduct?.price ?? 0),
      quantity,
      total: Number(order.total ?? 0),
      status: order.status || 'Pending',
      orderDate: this.formatOrderDate(
        order.createdAt
      ),
      artClass: firstProduct?.artClass || '',
      imageUrl,
      cancelReason: order.cancelReason || '',
      preferredDeliveryDate:
        order.preferredDeliveryDate || '',
      products: productNames,
      stockDeducted:
        order.stockDeducted === true,
      stockRestored:
        order.stockRestored === true
    };
  }

  // =========================================
  // FORMAT ORDER DATE
  // =========================================

  private formatOrderDate(value: any): string {
    if (!value) return 'Just now';

    let date: Date;

    if (typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (
      typeof value.seconds === 'number'
    ) {
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
  // CHECK ORDER OWNERSHIP
  // =========================================

  private isOwnOrder(order: SilkOrder): boolean {
    return Boolean(
      this.currentUserId &&
      this.auth.currentUser?.uid ===
        this.currentUserId &&
      order.userId === this.currentUserId
    );
  }

  private findLatestOrder(
    orderId: string
  ): SilkOrder | undefined {
    return this.orders.find(
      order => order.id === orderId
    );
  }

  // =========================================
  // KEEP POPUPS SYNCHRONIZED
  // =========================================

  private synchronizePopups(): void {
    if (this.selectedOrder) {
      const latest = this.findLatestOrder(
        this.selectedOrder.id
      );

      if (
        !latest ||
        latest.status !== 'Pending'
      ) {
        if (!this.saving) {
          this.cancelOrderPopup = false;
          this.selectedOrder = null;
          this.selectedCancelReason = '';
        }
      } else {
        this.selectedOrder = latest;
      }
    }

    if (this.selectedDeleteOrder) {
      const latest = this.findLatestOrder(
        this.selectedDeleteOrder.id
      );

      if (
        !latest ||
        !['Cancelled', 'Delivered', 'Rejected'].includes(
          latest.status
        )
      ) {
        if (!this.deletingOrder) {
          this.deleteOrderPopup = false;
          this.selectedDeleteOrder = null;
        }
      } else {
        this.selectedDeleteOrder = latest;
      }
    }
  }

  // =========================================
  // CANCEL ORDER POPUP
  // =========================================

  openCancelPopup(order: SilkOrder): void {
    if (
      this.saving ||
      this.deletingOrder ||
      !this.isOwnOrder(order)
    ) {
      return;
    }

    const latest = this.findLatestOrder(
      order.id
    );

    if (!latest) {
      alert('Order not found.');
      return;
    }

    if (latest.status !== 'Pending') {
      alert(
        'Only pending orders can be cancelled.'
      );
      return;
    }

    this.selectedOrder = latest;
    this.selectedCancelReason = '';
    this.cancelOrderPopup = true;

    this.refresh();
  }

  closeCancelPopup(): void {
    if (this.saving) return;

    this.cancelOrderPopup = false;
    this.selectedOrder = null;
    this.selectedCancelReason = '';

    this.refresh();
  }

  selectCancelReason(reason: string): void {
    if (
      this.saving ||
      !this.cancelReasons.includes(reason)
    ) {
      return;
    }

    this.selectedCancelReason = reason;
    this.refresh();
  }

  // =========================================
  // CONFIRM ORDER CANCELLATION
  // =========================================

  async confirmCancellation(): Promise<void> {
    if (
      this.saving ||
      this.deletingOrder ||
      !this.selectedOrder ||
      !this.currentUserId
    ) {
      return;
    }

    const order = this.findLatestOrder(
      this.selectedOrder.id
    );

    if (
      !order ||
      !this.isOwnOrder(order)
    ) {
      alert(
        'This order is no longer available.'
      );
      return;
    }

    if (order.status !== 'Pending') {
      alert(
        'Only pending orders can be cancelled.'
      );
      return;
    }

    const reason =
      this.selectedCancelReason.trim();

    if (
      !reason ||
      !this.cancelReasons.includes(reason)
    ) {
      alert(
        'Please select a cancellation reason.'
      );
      return;
    }

    const session = this.session;

    this.saving = true;
    this.refresh();

    try {
      await this.orderService.cancelMyOrder(
        order.id,
        reason
      );

      if (
        this.destroyed ||
        session !== this.session
      ) {
        return;
      }

      this.saving = false;
      this.closeCancelPopup();

    } catch (error: any) {
      console.error(
        'Order cancellation failed:',
        error
      );

      if (
        !this.destroyed &&
        session === this.session
      ) {
        alert(
          error?.code === 'permission-denied'
            ? 'Firebase denied cancellation. Check the order and inventory security rules.'
            : error?.message ||
              'Unable to cancel this order.'
        );
      }
    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // DELETE ORDER POPUP
  // =========================================

  deleteOrder(order: SilkOrder): void {
    if (
      this.saving ||
      this.deletingOrder ||
      !this.isOwnOrder(order)
    ) {
      return;
    }

    const latest = this.findLatestOrder(
      order.id
    );

    if (!latest) {
      alert('Order not found.');
      return;
    }

    if (
      !['Cancelled', 'Delivered', 'Rejected'].includes(
        latest.status
      )
    ) {
      alert(
        'Only Cancelled, Delivered or Rejected orders can be deleted.'
      );
      return;
    }

    if (
      latest.status === 'Cancelled' &&
      latest.stockDeducted &&
      !latest.stockRestored
    ) {
      alert(
        'This order cannot be deleted until its stock has been restored.'
      );
      return;
    }

    this.selectedDeleteOrder = latest;
    this.deleteOrderPopup = true;

    this.refresh();
  }

  closeDeletePopup(): void {
    if (this.deletingOrder) return;

    this.deleteOrderPopup = false;
    this.selectedDeleteOrder = null;

    this.refresh();
  }

  // =========================================
  // CONFIRM PERMANENT DELETION
  // =========================================

  async confirmDeleteOrder(): Promise<void> {
    if (
      this.deletingOrder ||
      this.saving ||
      !this.selectedDeleteOrder ||
      !this.currentUserId
    ) {
      return;
    }

    const order = this.findLatestOrder(
      this.selectedDeleteOrder.id
    );

    if (
      !order ||
      !this.isOwnOrder(order)
    ) {
      alert(
        'This order is no longer available.'
      );
      return;
    }

    if (
      !['Cancelled', 'Delivered', 'Rejected'].includes(
        order.status
      )
    ) {
      alert(
        'This order cannot be deleted in its current status.'
      );
      return;
    }

    if (
      order.status === 'Cancelled' &&
      order.stockDeducted &&
      !order.stockRestored
    ) {
      alert(
        'Inventory must be restored before deleting this order.'
      );
      return;
    }

    const session = this.session;

    this.deletingOrder = true;
    this.refresh();

    try {
      if (order.status === 'Cancelled') {
        await this.orderService.deleteMyCancelledOrder(
          order.id
        );
      } else {
        await this.deleteCompletedOrderFromFirestore(
          order
        );
      }

      if (
        this.destroyed ||
        session !== this.session
      ) {
        return;
      }

      this.deletedOrderIds.add(order.id);

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

      if (
        !this.destroyed &&
        session === this.session
      ) {
        alert(
          error?.code === 'permission-denied'
            ? 'Firebase denied deletion. Check your Firestore delete rule.'
            : error?.message ||
              'Unable to permanently delete this order.'
        );
      }

    } finally {
      this.deletingOrder = false;
      this.refresh();
    }
  }

  // =========================================
  // DELETE OWN DELIVERED / REJECTED ORDER
  // =========================================

  private async deleteCompletedOrderFromFirestore(
    order: SilkOrder
  ): Promise<void> {

    if (
      !this.isOwnOrder(order) ||
      (
        order.status !== 'Delivered' &&
        order.status !== 'Rejected'
      )
    ) {
      throw new Error(
        'This completed order cannot be deleted.'
      );
    }

    const userId = this.currentUserId;

    const orderRef = doc(
      this.firestore,
      'orders',
      order.id
    );

    const messagesRef = collection(
      this.firestore,
      'orders',
      order.id,
      'messages'
    );

    // Read the order and chat messages before deletion.
    const [orderSnapshot, messagesSnapshot] =
      await Promise.all([
        runInInjectionContext(
          this.injector,
          () => getDoc(orderRef)
        ),
        runInInjectionContext(
          this.injector,
          () => getDocs(messagesRef)
        )
      ]);

    if (!orderSnapshot.exists()) {
      throw new Error(
        'This order was already deleted. Refresh your orders.'
      );
    }

    const latest = orderSnapshot.data();

    if (
      String(latest['customerId'] || '') !== userId
    ) {
      throw new Error(
        'This is not your order.'
      );
    }

    if (
      !['Delivered', 'Rejected'].includes(
        String(latest['status'] || '')
      )
    ) {
      throw new Error(
        'Only Delivered or Rejected orders can be deleted.'
      );
    }

    // Keep the operation within a single batch.
    if (messagesSnapshot.size > 400) {
      throw new Error(
        'This order has too many chat messages for one deletion. ' +
        'Contact SilkMart staff.'
      );
    }

    if (
      this.auth.currentUser?.uid !== userId
    ) {
      throw new Error(
        'Your login session changed. Try again.'
      );
    }

    const batch = writeBatch(this.firestore);

    for (const message of messagesSnapshot.docs) {
      batch.delete(message.ref);
    }

    // Deleting an order must not restore or deduct stock.
    batch.delete(orderRef);

    await runInInjectionContext(
      this.injector,
      () => batch.commit()
    );
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
  // TRACK / REFRESH ORDER
  // =========================================

  trackOrder(): void {
    if (
      this.currentUserId &&
      this.auth.currentUser
    ) {
      this.loadOrders();
    } else {
      this.router.navigate(['/login']);
    }
  }

  // =========================================
  // CLEANUP
  // =========================================

  ngOnDestroy(): void {
    this.destroyed = true;
    this.session++;

    this.ordersSubscription?.unsubscribe();
    this.ordersSubscription = null;

    this.stopAuthListener?.();
    this.stopAuthListener = null;
  }
}
