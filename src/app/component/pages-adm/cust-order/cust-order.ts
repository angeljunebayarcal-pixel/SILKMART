
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ChangeDetectorRef,
  Component,
  Injector,
  NgZone,
  OnDestroy,
  OnInit,
  runInInjectionContext
} from '@angular/core';

import {
  Auth,
  onAuthStateChanged
} from '@angular/fire/auth';

import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch
} from '@angular/fire/firestore';

import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

import {
  OrderServ,
  SilkMartOrder,
  OrderStatus
} from '../../../services/order.serv';

import {
  OrderChatServ,
  OrderChatMessage
} from '../../../services/order-chat.serv';

// =========================================
// TYPES
// =========================================

type AdminOrderStatus = OrderStatus;

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}

interface OrderItem {
  name: string;
  quantity: number;
  image: string;
  artClass: string;
}

interface CustomerOrder {
  id: string;
  customer: Customer;
  items: OrderItem[];
  orderedAt: any;
  preferredDate: string;
  status: AdminOrderStatus;
  notes: string;
  cancelReason: string;
}

@Component({
  selector: 'app-cust-order',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cust-order.html',
  styleUrl: './cust-order.scss'
})
export class CustOrder implements OnInit, OnDestroy {

  // =========================================
  // ACCOUNT
  // =========================================

  currentUserId = '';
  authResolved = false;

  loadingOrders = true;
  orderError = '';

  private stopAuthListener: (() => void) | null = null;

  private ordersSubscription: Subscription | null = null;

  // =========================================
  // ORDERS
  // =========================================

  orders: CustomerOrder[] = [];

  selectedOrder: CustomerOrder | null = null;
  detailOrder: CustomerOrder | null = null;

  showOrderDetails = false;
  showChat = false;

  search = '';
  statusFilter = 'All';
  sortOrder = 'latest';

  showAllOrders = false;

  updatingOrderId = '';
  deletingOrderId = '';

  // Hide successfully deleted orders from delayed Firestore snapshots.
  private readonly deletedOrderIds = new Set<string>();

  // =========================================
  // CHAT
  // =========================================

  messageInput = '';

  messages: OrderChatMessage[] = [];

  chatLoading = false;
  chatSending = false;
  chatError = '';

  private chatSubscription: Subscription | null = null;

  private activeChatId = '';

  // Prevent callbacks from an old conversation
  // changing the currently opened conversation.
  private chatSession = 0;

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private auth: Auth,
    private injector: Injector,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private orderService: OrderServ,
    private chatService: OrderChatServ,
    private firestore: Firestore
  ) {}

  // =========================================
  // INITIALIZATION
  // =========================================

  ngOnInit(): void {

    this.stopAuthListener = runInInjectionContext(
      this.injector,
      () => onAuthStateChanged(
        this.auth,

        user => {

          this.zone.run(() => {

            this.ordersSubscription?.unsubscribe();
            this.ordersSubscription = null;

            this.resetChat();

            this.authResolved = true;

            const nextUserId = user?.uid ?? '';
            if (nextUserId !== this.currentUserId) {
              this.deletedOrderIds.clear();
            }
            this.currentUserId = nextUserId;

            this.orders = [];
            this.selectedOrder = null;
            this.detailOrder = null;

            this.showOrderDetails = false;

            if (!user) {

              this.loadingOrders = false;

              this.orderError =
                'Please sign in with an Admin or Staff account.';

              this.refreshUI();
              return;
            }

            this.loadOrders();

            this.refreshUI();
          });
        },

        error => {

          this.zone.run(() => {

            console.error(
              'Authentication error:',
              error
            );

            this.authResolved = true;
            this.loadingOrders = false;

            this.orderError =
              'Unable to verify your account.';

            this.refreshUI();
          });
        }
      )
    );
  }

  ngOnDestroy(): void {

    this.ordersSubscription?.unsubscribe();
    this.ordersSubscription = null;

    this.resetChat();

    this.stopAuthListener?.();
    this.stopAuthListener = null;
  }

  // =========================================
  // FORCE ANGULAR UI UPDATE
  // =========================================

  private refreshUI(): void {

    this.cdr.detectChanges();
  }

  // =========================================
  // FIRESTORE ORDERS
  // =========================================

  loadOrders(): void {

    if (!this.currentUserId) {

      this.orders = [];
      this.loadingOrders = false;

      this.refreshUI();
      return;
    }

    this.ordersSubscription?.unsubscribe();

    this.loadingOrders = true;
    this.orderError = '';

    this.ordersSubscription = runInInjectionContext(
      this.injector,

      () => this.orderService.getAllOrders()
        .subscribe({

          next: (firebaseOrders: SilkMartOrder[]) => {

            this.zone.run(() => {

              this.orders = firebaseOrders
                .map(order => this.convertOrder(order))
                .filter(order => !this.deletedOrderIds.has(order.id));

              // Keep selected profile updated.

              if (this.selectedOrder) {

                this.selectedOrder =
                  this.orders.find(
                    order =>
                      order.id === this.selectedOrder?.id
                  ) ?? null;
              }

              // Keep View Order popup updated.

              if (this.detailOrder) {

                this.detailOrder =
                  this.orders.find(
                    order =>
                      order.id === this.detailOrder?.id
                  ) ?? null;

                if (!this.detailOrder) {
                  this.showOrderDetails = false;
                }
              }

              // If the order was permanently
              // deleted, close its conversation.

              if (
                this.showChat &&
                !this.orders.some(
                  order => order.id === this.activeChatId
                )
              ) {
                this.resetChat();
              }

              this.loadingOrders = false;
              this.orderError = '';

              this.refreshUI();
            });
          },

          error: error => {

            this.zone.run(() => {

              console.error(
                'Unable to load orders:',
                error
              );

              this.orders = [];
              this.loadingOrders = false;

              this.orderError =
                error?.code === 'permission-denied'
                  ? 'Your account does not have permission to view Admin/Staff orders.'
                  : 'Unable to load orders from Firebase.';

              this.refreshUI();
            });
          }
        })
    );
  }

  // =========================================
  // CONVERT FIRESTORE ORDER
  // =========================================

  private convertOrder(
    order: SilkMartOrder
  ): CustomerOrder {

    const customerData = order.customer;

    return {

      id: String(order.id),

      customer: {

        id:
          order.customerId ||
          customerData?.uid ||
          '',

        name:
          customerData?.name ||
          'Unknown Customer',

        email:
          customerData?.email || '',

        phone:
          customerData?.phone || '',

        address:
          customerData?.address || ''
      },

      items: (
        Array.isArray(order.items)
          ? order.items
          : []
      ).map(item => ({

        name: item.name || 'Silk Product',

        quantity: Number(item.quantity || 0),

        image: item.image || '',

        artClass: item.artClass || ''
      })),

      orderedAt: order.createdAt,

      preferredDate:
        order.preferredDeliveryDate || '',

      status:
        order.status || 'Pending',

      notes: order.notes || '',

      cancelReason:
        order.cancelReason || ''
    };
  }

  // =========================================
  // DASHBOARD SUMMARY
  // =========================================

  get totalOrders(): number {
    return this.orders.length;
  }

  get pendingOrders(): number {
    return this.orders.filter(
      order => order.status === 'Pending'
    ).length;
  }

  get confirmedOrders(): number {
    return this.orders.filter(
      order => order.status === 'Confirmed'
    ).length;
  }

  get rejectedOrders(): number {
    return this.orders.filter(
      order => order.status === 'Rejected'
    ).length;
  }

  get cancelledOrders(): number {
    return this.orders.filter(
      order => order.status === 'Cancelled'
    ).length;
  }

  get deliveredOrders(): number {
    return this.orders.filter(
      order => order.status === 'Delivered'
    ).length;
  }

  // =========================================
  // FILTERS
  // =========================================

  get filteredOrders(): CustomerOrder[] {

    const term = this.search.trim().toLowerCase();

    return this.orders

      .filter(order => {

        const searchable = [
          order.id,
          order.customer.name,
          order.customer.email,
          order.customer.phone,
          ...order.items.map(item => item.name)
        ].join(' ').toLowerCase();

        const searchMatch =
          !term || searchable.includes(term);

        const statusMatch =
          this.statusFilter === 'All' ||
          order.status === this.statusFilter;

        return searchMatch && statusMatch;
      })

      .sort((a, b) => {

        if (this.sortOrder === 'name') {

          return a.customer.name.localeCompare(
            b.customer.name
          );
        }

        const aDate = this.toMillis(a.orderedAt);
        const bDate = this.toMillis(b.orderedAt);

        return this.sortOrder === 'oldest'
          ? aDate - bDate
          : bDate - aDate;
      });
  }

  get visibleOrders(): CustomerOrder[] {

    return this.showAllOrders
      ? this.filteredOrders
      : this.filteredOrders.slice(0, 2);
  }

  toggleOrders(): void {

    this.showAllOrders = !this.showAllOrders;
  }

  // =========================================
  // ORDER SELECTION
  // =========================================

  selectOrder(order: CustomerOrder): void {

    this.selectedOrder = order;
  }

  openOrderDetails(order: CustomerOrder): void {

    this.resetChat();

    this.selectedOrder = order;
    this.detailOrder = order;

    this.showOrderDetails = true;
  }

  closeOrderDetails(): void {

    this.showOrderDetails = false;
    this.detailOrder = null;
  }

  contactFromDetails(): void {

    const order = this.detailOrder;

    if (!order) return;

    this.closeOrderDetails();
    this.openChat(order);
  }

  // =========================================
  // ORDER INFORMATION
  // =========================================

  getOrderQuantity(order: CustomerOrder): number {

    return order.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
  }

  getFirstItem(order: CustomerOrder): OrderItem {

    return order.items[0] || {

      name: 'Silk Product',
      quantity: 0,
      image: '',
      artClass: ''
    };
  }

  // =========================================
  // CUSTOMER PROFILE
  // =========================================

  get customerOrderCount(): number {

    if (!this.selectedOrder) return 0;

    return this.orders.filter(
      order =>
        order.customer.id ===
        this.selectedOrder?.customer.id
    ).length;
  }

  get customerConfirmedCount(): number {

    if (!this.selectedOrder) return 0;

    return this.orders.filter(
      order =>
        order.customer.id ===
          this.selectedOrder?.customer.id &&
        (
          order.status === 'Confirmed' ||
          order.status === 'Delivered'
        )
    ).length;
  }

  // =========================================
  // CONFIRM ORDER
  // =========================================

  async confirmOrder(order: CustomerOrder): Promise<void> {

    if (
      order.status !== 'Pending' ||
      this.updatingOrderId
    ) return;

    const result = await Swal.fire({

      icon: 'question',

      title: 'Confirm Customer Order?',

      text:
        `Confirm order #${order.id} ` +
        `for ${order.customer.name}?`,

      showCancelButton: true,

      confirmButtonText: 'Confirm Order',

      confirmButtonColor: '#28785b',

      reverseButtons: true
    });

    if (!result.isConfirmed) return;

    await this.changeStatus(order, 'Confirmed');
  }

  // =========================================
  // REJECT ORDER
  // =========================================

  async rejectOrder(order: CustomerOrder): Promise<void> {

    if (
      order.status !== 'Pending' ||
      this.updatingOrderId
    ) return;

    const result = await Swal.fire({

      icon: 'warning',

      title: 'Reject Customer Order?',

      text:
        `Reject order #${order.id} ` +
        `for ${order.customer.name}?`,

      showCancelButton: true,

      confirmButtonText: 'Reject Order',

      confirmButtonColor: '#c34f4f',

      reverseButtons: true
    });

    if (!result.isConfirmed) return;

    await this.changeStatus(order, 'Rejected');
  }

  // =========================================
  // UPDATE ORDER STATUS
  // =========================================

  private async changeStatus(
    order: CustomerOrder,
    status: 'Confirmed' | 'Rejected' | 'Delivered'
  ): Promise<void> {

    this.updatingOrderId = order.id;

    try {

      await this.orderService.updateOrderStatus(
        order.id,
        status
      );

      await Swal.fire({

        icon: 'success',

        title:
          status === 'Confirmed'
            ? 'Order Confirmed'
            : status === 'Rejected'
              ? 'Order Rejected'
              : 'Order Delivered',

        timer: 1400,

        showConfirmButton: false
      });

    } catch (error: any) {

      console.error(
        'Order status failed:',
        error
      );

      await Swal.fire({

        icon: 'error',

        title: 'Unable to Update Order',

        text:
          error?.message ||
          'Unable to save order status.',

        confirmButtonColor: '#28785b'
      });

    } finally {

      this.zone.run(() => {

        this.updatingOrderId = '';

        this.refreshUI();
      });
    }
  }


  // =========================================
  // PERMANENTLY DELETE DELIVERED / REJECTED ORDER
  // =========================================

  async deleteCompletedOrder(order: CustomerOrder): Promise<void> {
    if (
      !this.currentUserId ||
      this.auth.currentUser?.uid !== this.currentUserId ||
      this.deletingOrderId ||
      this.updatingOrderId ||
      this.deletedOrderIds.has(order.id) ||
      (order.status !== 'Delivered' && order.status !== 'Rejected')
    ) {
      return;
    }

    const confirmation = await Swal.fire({
      icon: 'warning',
      title: 'Permanently Delete Order?',
      html:
        `Order <strong>#${this.escapeHtml(order.id)}</strong> ` +
        `(${this.escapeHtml(order.status)}) will be permanently removed, ` +
        'including its saved order chat messages. ' +
        '<br><br><strong>This cannot be undone.</strong> ' +
        'It will not restore or change silkworm/product inventory.',
      showCancelButton: true,
      confirmButtonText: 'Yes, Delete Permanently',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#c34747',
      reverseButtons: true,
      focusCancel: true
    });

    if (!confirmation.isConfirmed) return;

    const orderId = order.id;
    const actorUid = this.currentUserId;
    this.deletingOrderId = orderId;
    this.refreshUI();

    try {
      await runInInjectionContext(this.injector, async () => {
        const orderRef = doc(this.firestore, 'orders', orderId);
        const messagesRef = collection(
          this.firestore, 'orders', orderId, 'messages'
        );

        // Check Firestore's latest status and retrieve messages before
        // adding writes. A single batch removes the order and its chat
        // messages, without touching any product or species stock.
        const [orderSnapshot, messagesSnapshot] = await Promise.all([
          getDoc(orderRef),
          getDocs(messagesRef)
        ]);

        if (!orderSnapshot.exists()) {
          throw new Error('This order has already been deleted.');
        }

        const currentStatus = String(
          orderSnapshot.data()?.['status'] || ''
        );

        if (
          currentStatus !== 'Delivered' &&
          currentStatus !== 'Rejected'
        ) {
          throw new Error(
            'Only Delivered or Rejected orders can be deleted.'
          );
        }

        // Each message, the order and the audit entry consume one write.
        // Refuse large deletions instead of partially removing data.
        if (messagesSnapshot.size > 400) {
          throw new Error(
            'This order contains too many chat messages for safe one-step ' +
            'deletion. Contact the system administrator.'
          );
        }

        if (
          !this.auth.currentUser ||
          this.auth.currentUser.uid !== actorUid
        ) {
          throw new Error('Your signed-in account changed. Try again.');
        }

        const activityRef = doc(
          collection(this.firestore, 'inventory_activity')
        );
        const batch = writeBatch(this.firestore);

        for (const message of messagesSnapshot.docs) {
          batch.delete(message.ref);
        }

        batch.delete(orderRef);
        batch.set(activityRef, {
          message: 'Customer order permanently deleted',
          detail: `Order #${orderId} (${currentStatus}) permanently deleted by staff`,
          type: 'remove',
          actorUid,
          createdAt: serverTimestamp()
        });

        await batch.commit();
      });

      this.zone.run(() => {
        // The real-time subscription will also refresh this list.
        // Update immediately for responsive feedback.
        this.deletedOrderIds.add(orderId);
        this.orders = this.orders.filter(item => item.id !== orderId);

        if (this.detailOrder?.id === orderId) {
          this.closeOrderDetails();
        }

        if (this.selectedOrder?.id === orderId) {
          this.resetChat();
          this.selectedOrder = null;
        }

        this.refreshUI();
      });

      await Swal.fire({
        icon: 'success',
        title: 'Order Deleted',
        text: 'The order and its saved chat messages were deleted from Firestore.',
        timer: 1800,
        showConfirmButton: false
      });

    } catch (error: any) {
      console.error('Delete customer order failed:', error);

      await Swal.fire({
        icon: 'error',
        title: 'Unable to Delete Order',
        text: error?.code === 'permission-denied'
          ? 'Firestore denied deletion. Publish the updated Orders and Chat deletion rules and check your Admin/Staff permissions.'
          : error?.message || 'Could not permanently delete this order.',
        confirmButtonColor: '#28785b'
      });

    } finally {
      this.zone.run(() => {
        this.deletingOrderId = '';
        this.refreshUI();
      });
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => {
      const values: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return values[character];
    });
  }

  // =========================================
  // OPEN REAL-TIME CHAT
  // =========================================

  openChat(order?: CustomerOrder): void {

    const target = order || this.selectedOrder;

    if (!target) return;

    // End the previous conversation listener.
    this.stopChatListener();

    this.chatSession++;

    const session = this.chatSession;

    this.selectedOrder = target;

    this.detailOrder = null;
    this.showOrderDetails = false;

    this.activeChatId = target.id;

    this.showChat = true;

    this.messageInput = '';
    this.messages = [];

    this.chatError = '';
    this.chatLoading = true;
    this.chatSending = false;

    this.refreshUI();

    // Subscribe to Firebase updates.
    this.chatSubscription = runInInjectionContext(
      this.injector,

      () => this.chatService
        .getMessages(target.id)
        .subscribe({

          next: (incomingMessages) => {

            // Firestore may invoke this callback
            // outside Angular change detection.

            this.zone.run(() => {

              if (
                session !== this.chatSession ||
                this.activeChatId !== target.id ||
                !this.showChat
              ) {
                return;
              }

              // Display the messages immediately.
              this.messages = [...incomingMessages];

              // IMPORTANT: Stop loading here.
              this.chatLoading = false;
              this.chatError = '';

              this.refreshUI();
            });
          },

          error: error => {

            this.zone.run(() => {

              if (
                session !== this.chatSession ||
                this.activeChatId !== target.id
              ) {
                return;
              }

              console.error(
                'Firebase chat listener error:',
                error
              );

              this.chatLoading = false;

              this.chatError =
                error?.code === 'permission-denied'
                  ? 'Firebase denied access to this conversation.'
                  : 'Unable to load conversation. Please check your connection.';

              this.refreshUI();
            });
          }
        })
    );
  }

  // =========================================
  // CLOSE CHAT
  // =========================================

  closeChat(): void {

    if (this.chatSending) return;

    this.resetChat();

    this.refreshUI();
  }

  private stopChatListener(): void {

    this.chatSubscription?.unsubscribe();

    this.chatSubscription = null;
  }

  private resetChat(): void {

    this.chatSession++;

    this.stopChatListener();

    this.showChat = false;

    this.activeChatId = '';

    this.messages = [];

    this.messageInput = '';
    this.chatError = '';

    this.chatLoading = false;
    this.chatSending = false;
  }

  // =========================================
  // SEND MESSAGE TO FIREBASE
  // =========================================

  async sendMessage(): Promise<void> {

    if (
      !this.showChat ||
      !this.selectedOrder ||
      this.chatSending
    ) {
      return;
    }

    const text = this.messageInput.trim();

    if (!text) return;

    const orderId = this.selectedOrder.id;
    const session = this.chatSession;

    this.chatSending = true;
    this.chatError = '';

    this.refreshUI();

    try {

      // Firebase writes to the same
      // conversation used by the customer.
      await this.chatService.sendMessage(
        orderId,
        text,
        'staff'
      );

      this.zone.run(() => {

        if (
          this.chatSession !== session ||
          this.activeChatId !== orderId
        ) {
          return;
        }

        // Clear input after the write succeeds.
        this.messageInput = '';

        // Firestore's message listener will
        // automatically show the new message.
        this.refreshUI();
      });

    } catch (error: any) {

      this.zone.run(() => {

        console.error(
          'Firebase send message error:',
          error
        );

        this.chatError =
          error?.code === 'permission-denied'
            ? 'Firebase denied your message. Check your Staff/Admin role and Firestore chat rules.'
            : error?.message ||
              'Unable to send the message. Please try again.';

        this.refreshUI();
      });

    } finally {

      // IMPORTANT: Always re-enable Send
      // after Firebase responds.

      this.zone.run(() => {

        if (this.chatSession === session) {
          this.chatSending = false;
        }

        this.refreshUI();
      });
    }
  }

  // =========================================
  // DELIVERY MESSAGE TEMPLATE
  // =========================================

  useDeliveryTemplate(): void {

    if (!this.selectedOrder) return;

    const date = this.formatDate(
      this.selectedOrder.preferredDate
    );

    this.messageInput =
      `Hello ${this.selectedOrder.customer.name}, ` +
      `this is SilkMart. We would like to discuss ` +
      `the delivery schedule for order #` +
      `${this.selectedOrder.id}` +
      (
        date !== 'Not specified'
          ? ` (${date})`
          : ''
      ) +
      `. Would you be available on another date? ` +
      `Please share your preferred schedule. Thank you!`;
  }

  // =========================================
  // DATE HELPERS
  // =========================================

  private toMillis(value: any): number {

    if (!value) return 0;

    if (typeof value.toMillis === 'function') {
      return value.toMillis();
    }

    if (typeof value.seconds === 'number') {
      return value.seconds * 1000;
    }

    const timestamp = new Date(value).getTime();

    return Number.isFinite(timestamp)
      ? timestamp
      : 0;
  }

  formatDate(value: any): string {

    if (!value) return 'Not specified';

    if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {

      const [year, month, day] =
        value.split('-').map(Number);

      return new Date(
        year,
        month - 1,
        day
      ).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }

    const timestamp = this.toMillis(value);

    if (!timestamp) {
      return 'Not specified';
    }

    return new Date(timestamp)
      .toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
  }

  formatTime(value: any): string {

    const timestamp = this.toMillis(value);

    if (!timestamp) return '';

    return new Date(timestamp)
      .toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit'
      });
  }

  // =========================================
  // STATUS AND DISPLAY
  // =========================================

  getStatusClass(
    status: AdminOrderStatus
  ): string {

    switch (status) {

      case 'Confirmed':
        return 'status-confirmed';

      case 'Rejected':
      case 'Cancelled':
        return 'status-rejected';

      case 'Delivered':
        return 'status-delivered';

      default:
        return 'status-pending';
    }
  }

  getInitials(name: string): string {

    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0))
      .join('')
      .toUpperCase() || '?';
  }

  trackOrder(
    _index: number,
    order: CustomerOrder
  ): string {

    return order.id;
  }

  trackMessage(
    index: number,
    message: OrderChatMessage
  ): string {

    return message.id ||
      `${message.senderUid}-${index}`;
  }
}
