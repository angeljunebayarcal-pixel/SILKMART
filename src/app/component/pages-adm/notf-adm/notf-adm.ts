
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  Injector,
  NgZone,
  OnDestroy,
  OnInit,
  runInInjectionContext
} from '@angular/core';
import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

import {
  OrderServ,
  SilkMartOrder
} from '../../../services/order.serv';

import {
  OrderChatServ,
  OrderChatMessage
} from '../../../services/order-chat.serv';

type AdminFilter =
  | 'all'
  | 'unread'
  | 'orders'
  | 'delivery'
  | 'chat';

interface AdminNotice {
  id: string;
  type: 'orders' | 'delivery' | 'chat';
  orderId: string;
  title: string;
  message: string;
  icon: string;
  time: string;
  sortTime: number;
  read: boolean;
  action: string;
  latestMessageId?: string;
}

interface NoticePreference {
  read?: boolean;
  deleted?: boolean;
  lastSeenMessageId?: string;
  deletedMessageId?: string;
}

@Component({
  selector: 'app-notf-adm',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notf-adm.html',
  styleUrl: './notf-adm.scss'
})
export class NotfAdm implements OnInit, OnDestroy {

  currentUserId = '';
  authResolved = false;
  loading = true;
  error = '';

  selectedFilter: AdminFilter = 'all';

  notices: AdminNotice[] = [];
  orders: SilkMartOrder[] = [];

  private messagesByOrder:
    Record<string, OrderChatMessage[]> = {};

  private chatSubscriptions =
    new Map<string, Subscription>();

  private ordersSubscription: Subscription | null = null;
  private stopAuth: (() => void) | null = null;

  private clockTimer:
    ReturnType<typeof setInterval> | null = null;

  private session = 0;

  constructor(
    private router: Router,
    private auth: Auth,
    private orderService: OrderServ,
    private chatService: OrderChatServ,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.stopAuth = runInInjectionContext(
      this.injector,
      () => onAuthStateChanged(this.auth, user => {
        this.zone.run(() => {

          this.session++;
          this.clearListeners();

          this.currentUserId = user?.uid || '';
          this.authResolved = true;

          this.notices = [];
          this.orders = [];
          this.messagesByOrder = {};
          this.error = '';

          if (user) {
            this.loadNotifications();
          } else {
            this.loading = false;
          }

          this.refresh();
        });
      })
    );

    this.clockTimer = setInterval(() => {
      this.zone.run(() => {
        if (this.currentUserId) {
          this.rebuildNotifications();
          this.refresh();
        }
      });
    }, 60_000);

    window.addEventListener(
      'storage',
      this.handleStorageChange
    );
  }

  ngOnDestroy(): void {
    this.session++;
    this.clearListeners();
    this.stopAuth?.();

    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }

    window.removeEventListener(
      'storage',
      this.handleStorageChange
    );
  }

  private refresh(): void {
    this.cdr.detectChanges();
  }

  private clearListeners(): void {
    this.ordersSubscription?.unsubscribe();
    this.ordersSubscription = null;

    for (const subscription of this.chatSubscriptions.values()) {
      subscription.unsubscribe();
    }

    this.chatSubscriptions.clear();
  }

  loadNotifications(): void {
    if (!this.currentUserId) return;

    this.ordersSubscription?.unsubscribe();

    this.loading = true;
    this.error = '';

    const currentSession = this.session;

    this.ordersSubscription = runInInjectionContext(
      this.injector,
      () => this.orderService.getAllOrders().subscribe({
        next: orders => {
          this.zone.run(() => {

            if (currentSession !== this.session) return;

            this.orders = orders;

            this.syncChatListeners(currentSession);
            this.rebuildNotifications();

            this.loading = false;
            this.error = '';

            this.refresh();
          });
        },

        error: err => {
          this.zone.run(() => {
            if (currentSession !== this.session) return;

            console.error('Admin notification error:', err);

            this.loading = false;

            this.error = err?.code === 'permission-denied'
              ? 'Your account is not permitted to view all orders.'
              : 'Unable to load notifications from Firebase.';

            this.refresh();
          });
        }
      })
    );
  }

  private syncChatListeners(currentSession: number): void {
    const activeIds = new Set(
      this.orders.map(order => order.id)
    );

    for (const [orderId, subscription] of
      this.chatSubscriptions.entries()) {

      if (!activeIds.has(orderId)) {
        subscription.unsubscribe();

        this.chatSubscriptions.delete(orderId);
        delete this.messagesByOrder[orderId];
      }
    }

    for (const order of this.orders) {
      if (this.chatSubscriptions.has(order.id)) {
        continue;
      }

      const orderId = order.id;

      const subscription = runInInjectionContext(
        this.injector,
        () => this.chatService.getMessages(orderId).subscribe({
          next: messages => {
            this.zone.run(() => {
              if (currentSession !== this.session) return;

              this.messagesByOrder[orderId] = messages;

              this.rebuildNotifications();
              this.refresh();
            });
          },

          error: err => {
            console.error(
              'Unable to load order chat:',
              orderId,
              err
            );
          }
        })
      );

      this.chatSubscriptions.set(orderId, subscription);
    }
  }

  private toMillis(value: any): number {
    if (!value) return 0;

    if (typeof value.toMillis === 'function') {
      return value.toMillis();
    }

    if (typeof value.seconds === 'number') {
      return value.seconds * 1000;
    }

    const millis = new Date(value).getTime();

    return Number.isFinite(millis) ? millis : 0;
  }

  private showTime(value: any): string {
    const time = this.toMillis(value);

    if (!time) return 'Recently';

    return new Date(time).toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  private localDate(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  private tomorrow(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);

    return this.localDate(date);
  }

  private prettyDate(value: string): string {
    const parts = value?.split('-').map(Number);

    if (
      !parts ||
      parts.length !== 3 ||
      parts.some(part => !Number.isFinite(part))
    ) {
      return value || 'Not provided';
    }

    return new Date(
      parts[0],
      parts[1] - 1,
      parts[2]
    ).toLocaleDateString('en-PH', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  private preferencesKey(): string {
    return (
      'silkmart_admin_notifications:' +
      this.currentUserId
    );
  }

  private getPreferences():
    Record<string, NoticePreference> {

    try {
      const parsed = JSON.parse(
        localStorage.getItem(
          this.preferencesKey()
        ) || '{}'
      );

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return {};
      }

      return parsed;

    } catch {
      return {};
    }
  }

  private savePreferences(
    preferences: Record<string, NoticePreference>
  ): void {

    try {
      localStorage.setItem(
        this.preferencesKey(),
        JSON.stringify(preferences)
      );

      // Immediately tell the topbar to refresh.
      // The storage event alone does not fire
      // in the tab that saved the data.
      window.dispatchEvent(
        new CustomEvent(
          'silkmart-admin-notifications-changed'
        )
      );

    } catch (error) {
      console.error(
        'Unable to save notification state:',
        error
      );
    }
  }

  private handleStorageChange = (
    event: StorageEvent
  ): void => {

    if (
      this.currentUserId &&
      event.key === this.preferencesKey()
    ) {
      this.zone.run(() => {
        this.rebuildNotifications();
        this.refresh();
      });
    }
  };

  // One notification card per order conversation.
  // New messages update that card rather than
  // creating additional chat cards.
  private latestCustomerMessage(
    orderId: string
  ): OrderChatMessage | null {

    const messages = (
      this.messagesByOrder[orderId] || []
    ).filter(message =>
      message.senderRole === 'customer' &&
      !!message.id
    );

    if (messages.length === 0) {
      return null;
    }

    return [...messages].sort((a, b) => {
      const difference =
        this.toMillis(b.createdAt) -
        this.toMillis(a.createdAt);

      if (difference !== 0) {
        return difference;
      }

      return String(b.id).localeCompare(
        String(a.id)
      );
    })[0];
  }

  private rebuildNotifications(): void {
    const preferences = this.getPreferences();
    const output: AdminNotice[] = [];

    const push = (
      item: Omit<AdminNotice, 'read'>
    ): void => {

      const preference = preferences[item.id] || {};

      if (item.type === 'chat') {
        // If a card was deleted, keep it hidden
        // until another customer message arrives.
        if (
          preference.deleted === true &&
          preference.deletedMessageId ===
            item.latestMessageId
        ) {
          return;
        }

        const wasRead =
          preference.lastSeenMessageId ===
          item.latestMessageId;

        output.push({
          ...item,
          read: wasRead
        });

        return;
      }

      if (preference.deleted === true) {
        return;
      }

      output.push({
        ...item,
        read: preference.read === true
      });
    };

    const tomorrow = this.tomorrow();
    const today = this.localDate(new Date());

    for (const order of this.orders) {
      const customer =
        order.customer?.name || 'A customer';

      const product =
        order.items?.[0]?.name || 'SilkMart products';

      const pieces = (order.items || []).reduce(
        (sum, item) =>
          sum + Number(item.quantity || 0),
        0
      );

      const createdTime = this.toMillis(
        order.createdAt
      );

      const updatedTime = this.toMillis(
        order.updatedAt
      );

      // ORDER NOTIFICATION

      push({
        id: `new-order:${order.id}`,
        type: 'orders',
        orderId: order.id,
        icon: 'pi pi-shopping-bag',
        title: 'New customer order',
        message:
          `${customer} placed an order for ${pieces} pcs, ` +
          `including ${product}. Open Customer Orders to review it.`,
        time: this.showTime(order.createdAt),
        sortTime: createdTime,
        action: 'View order'
      });

      // DELIVERY NOTIFICATIONS

      const status = String(
        order.status || 'Pending'
      );

      const raw = order as SilkMartOrder & {
        scheduledDeliveryDate?: string;
        deliveryStatus?: string;
        deliveryUpdatedAt?: any;
      };

      const scheduledDate =
        raw.scheduledDeliveryDate || '';

      const deliveryStatus =
        String(raw.deliveryStatus || '');

      if (
        status === 'Confirmed' &&
        !scheduledDate &&
        !['Cancelled', 'Delivered'].includes(
          deliveryStatus
        )
      ) {
        push({
          id: `schedule-required:${order.id}`,
          type: 'delivery',
          orderId: order.id,
          icon: 'pi pi-calendar-plus',
          title: 'Delivery needs scheduling',
          message:
            `Order #${order.id} is confirmed. ` +
            `Assign a delivery date for ${customer}.`,
          time: 'Ready to schedule',
          sortTime: updatedTime || createdTime,
          action: 'Open delivery'
        });
      }

      const eligibleForReminder =
        status === 'Confirmed' &&
        ['Scheduled', 'Preparing'].includes(
          deliveryStatus
        );

      if (
        eligibleForReminder &&
        scheduledDate === tomorrow
      ) {
        push({
          id:
            `dispatch-tomorrow:${order.id}:${scheduledDate}`,
          type: 'delivery',
          orderId: order.id,
          icon: 'pi pi-clock',
          title: 'Delivery scheduled for tomorrow',
          message:
            `${customer}'s order #${order.id} is scheduled ` +
            `for ${this.prettyDate(scheduledDate)}. ` +
            `Check the preparation checklist and arrange dispatch.`,
          time: 'Tomorrow',
          sortTime: Date.now(),
          action: 'View delivery'
        });
      }

      if (
        eligibleForReminder &&
        scheduledDate === today
      ) {
        push({
          id:
            `dispatch-today:${order.id}:${scheduledDate}`,
          type: 'delivery',
          orderId: order.id,
          icon: 'pi pi-truck',
          title: 'Delivery scheduled for today',
          message:
            `Order #${order.id} for ${customer} is due today. ` +
            `Dispatch it when the products actually leave.`,
          time: 'Today',
          sortTime: Date.now(),
          action: 'View delivery'
        });
      }

      // GROUPED CUSTOMER CHAT
      // One card only for each order.

      const latestMessage =
        this.latestCustomerMessage(order.id);

      if (latestMessage?.id) {
        const messageTime = this.toMillis(
          latestMessage.createdAt
        );

        push({
          id: `customer-chat:${order.id}`,
          type: 'chat',
          orderId: order.id,
          latestMessageId: latestMessage.id,
          icon: 'pi pi-comments',
          title: `Message from ${customer}`,
          message:
            `Order #${order.id}: ${latestMessage.text}`,
          time: this.showTime(
            latestMessage.createdAt
          ),
          sortTime: messageTime,
          action: 'Open conversation'
        });
      }
    }

    this.notices = output.sort(
      (a, b) =>
        b.sortTime - a.sortTime ||
        a.id.localeCompare(b.id)
    );
  }

  get unreadCount(): number {
    return this.notices.filter(
      item => !item.read
    ).length;
  }

  get ordersCount(): number {
    return this.notices.filter(
      item => item.type === 'orders'
    ).length;
  }

  get deliveryCount(): number {
    return this.notices.filter(
      item => item.type === 'delivery'
    ).length;
  }

  get chatCount(): number {
    return this.notices.filter(
      item => item.type === 'chat'
    ).length;
  }

  get unreadChatCount(): number {
    return this.notices.filter(
      item =>
        item.type === 'chat' &&
        !item.read
    ).length;
  }

  get filteredNotifications(): AdminNotice[] {
    switch (this.selectedFilter) {
      case 'unread':
        return this.notices.filter(
          item => !item.read
        );

      case 'orders':
      case 'delivery':
      case 'chat':
        return this.notices.filter(
          item => item.type === this.selectedFilter
        );

      default:
        return this.notices;
    }
  }

  setFilter(filter: AdminFilter): void {
    this.selectedFilter = filter;
  }

  markAsRead(item: AdminNotice): void {
    const preferences = this.getPreferences();

    if (item.type === 'chat') {
      preferences[item.id] = {
        ...preferences[item.id],
        read: true,
        deleted: false,
        lastSeenMessageId: item.latestMessageId
      };
    } else {
      preferences[item.id] = {
        ...preferences[item.id],
        read: true
      };
    }

    item.read = true;
    this.savePreferences(preferences);
  }

  markAllAsRead(): void {
    const preferences = this.getPreferences();

    for (const item of this.filteredNotifications) {

      if (item.type === 'chat') {
        preferences[item.id] = {
          ...preferences[item.id],
          read: true,
          deleted: false,
          lastSeenMessageId: item.latestMessageId
        };
      } else {
        preferences[item.id] = {
          ...preferences[item.id],
          read: true
        };
      }

      item.read = true;
    }

    this.savePreferences(preferences);
  }

  async deleteNotification(item: AdminNotice): Promise<void> {

    const result = await Swal.fire({
      title: 'Remove Notification?',
      text: 'Are you sure you want to remove this notification from your list? This will not delete the actual customer order or message.',
      icon: 'warning',

      showCancelButton: true,

      confirmButtonText: 'Yes, Remove',
      cancelButtonText: 'Cancel',

      confirmButtonColor: '#287156',
      cancelButtonColor: '#8b9a8f',

      reverseButtons: true,
      focusCancel: true,

      background: '#fbfaf4'
    });

    if (!result.isConfirmed) {
      return;
    }

    const preferences = this.getPreferences();

    if (item.type === 'chat') {
      preferences[item.id] = {
        ...preferences[item.id],
        read: true,
        deleted: true,
        lastSeenMessageId: item.latestMessageId,
        deletedMessageId: item.latestMessageId
      };
    } else {
      preferences[item.id] = {
        ...preferences[item.id],
        read: true,
        deleted: true
      };
    }

    this.savePreferences(preferences);

    this.notices = this.notices.filter(
      notice => notice.id !== item.id
    );

    await Swal.fire({
      icon: 'success',
      title: 'Notification Removed',
      text: 'The notification has been removed from your list.',
      confirmButtonColor: '#287156',
      background: '#fbfaf4',
      timer: 1500,
      showConfirmButton: false
    });
  }

  openNotification(item: AdminNotice): void {
    this.markAsRead(item);

    if (item.type === 'delivery') {
      this.router.navigate([
        '/home-adm/delivery'
      ]);
      return;
    }

    // The Customer Orders page contains
    // the existing Admin/Staff chat interface.
    this.router.navigate([
      '/home-adm/cust-order'
    ]);
  }
}
