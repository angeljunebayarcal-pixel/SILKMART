
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

import {
  OrderChatServ,
  OrderChatMessage
} from '../../../services/order-chat.serv';

type NotificationFilter =
  | 'all'
  | 'unread'
  | 'orders'
  | 'chat';

interface CustomerNotification {
  id: string;
  type: 'order';
  icon: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  actionLabel: string;
  sortTime: number;
  orderId: string;
}

interface NotificationPreference {
  read: boolean;
  deleted: boolean;
}

// Each order stores IDs of staff messages
// that this customer has already opened.
type SeenChatMessages = Record<string, string[]>;

@Component({
  selector: 'app-notif-cust',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './notif-cust.html',
  styleUrl: './notif-cust.scss'
})
export class NotifCust implements OnInit, OnDestroy {

  // =========================================
  // ACCOUNT
  // =========================================

  currentUserId = '';
  authResolved = false;

  selectedFilter: NotificationFilter = 'all';

  notifications: CustomerNotification[] = [];
  customerOrders: SilkMartOrder[] = [];

  loadingNotifications = true;
  notificationError = '';

  // =========================================
  // DELETE NOTIFICATION
  // =========================================

  deleteConfirmPopup = false;

  selectedDeleteNotification:
    CustomerNotification | null = null;

  // =========================================
  // CHAT
  // =========================================

  showChatPopup = false;

  selectedChatOrder: SilkMartOrder | null = null;

  chatMessages: OrderChatMessage[] = [];

  chatInput = '';
  chatSaving = false;
  chatLoading = false;
  chatError = '';

  // =========================================
  // UNREAD CHAT COUNTS
  // =========================================

  unreadChatsByOrder: Record<string, number> = {};

  private messagesByOrder:
    Record<string, OrderChatMessage[]> = {};

  private seenChatMessages: SeenChatMessages = {};

  private chatListeners = new Map<string, Subscription>();

  // =========================================
  // SUBSCRIPTIONS
  // =========================================

  private stopAuthListener: (() => void) | null = null;

  private ordersSub: Subscription | null = null;

  private chatSub: Subscription | null = null;

  private accountSession = 0;

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private router: Router,
    private auth: Auth,
    private injector: Injector,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private orderService: OrderServ,
    private chatService: OrderChatServ
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

            this.accountSession++;

            this.ordersSub?.unsubscribe();

            this.stopAllChatListeners();

            this.closeChat(true);

            this.authResolved = true;

            this.currentUserId = user?.uid ?? '';

            this.customerOrders = [];
            this.notifications = [];

            this.unreadChatsByOrder = {};
            this.messagesByOrder = {};

            this.seenChatMessages = this.currentUserId
              ? this.loadSeenChatMessages()
              : {};

            if (!user) {
              this.loadingNotifications = false;
              this.notificationError = '';
              this.refreshUI();
              return;
            }

            this.loadNotifications();

            this.refreshUI();
          });
        },

        error => {
          this.zone.run(() => {
            console.error('Auth error:', error);

            this.authResolved = true;
            this.loadingNotifications = false;

            this.notificationError =
              'Unable to verify your account.';

            this.refreshUI();
          });
        }
      )
    );

    window.addEventListener(
      'storage',
      this.handleStorageChange
    );
  }

  ngOnDestroy(): void {
    this.ordersSub?.unsubscribe();

    this.stopAllChatListeners();

    this.chatSub?.unsubscribe();

    this.stopAuthListener?.();

    window.removeEventListener(
      'storage',
      this.handleStorageChange
    );
  }

  private refreshUI(): void {
    this.cdr.detectChanges();
  }

  // =========================================
  // FIRESTORE ORDERS
  // =========================================

  loadNotifications(): void {

    if (!this.currentUserId) {
      this.customerOrders = [];
      this.notifications = [];
      this.loadingNotifications = false;
      return;
    }

    this.ordersSub?.unsubscribe();

    this.loadingNotifications = true;
    this.notificationError = '';

    const session = this.accountSession;
    const uid = this.currentUserId;

    this.ordersSub = runInInjectionContext(
      this.injector,

      () => this.orderService.getMyOrders().subscribe({

        next: orders => {
          this.zone.run(() => {

            if (
              session !== this.accountSession ||
              uid !== this.currentUserId
            ) {
              return;
            }

            this.customerOrders = orders.filter(
              order => order.customerId === uid
            );

            this.rebuildNotifications();

            // Start one live chat listener
            // for each customer order.
            this.syncChatListeners(session);

            this.loadingNotifications = false;
            this.notificationError = '';

            if (this.selectedChatOrder) {

              const updated = this.customerOrders.find(
                order =>
                  order.id === this.selectedChatOrder?.id
              );

              if (updated) {
                this.selectedChatOrder = updated;
              } else {
                this.closeChat(true);
              }
            }

            this.refreshUI();
          });
        },

        error: error => {
          this.zone.run(() => {
            console.error(
              'Notifications error:',
              error
            );

            this.loadingNotifications = false;

            this.notificationError =
              error?.code === 'permission-denied'
                ? 'Firebase denied access to your orders.'
                : 'Unable to load notifications. Check your connection.';

            this.refreshUI();
          });
        }
      })
    );
  }

  // =========================================
  // ORDER NOTIFICATIONS
  // =========================================

  private rebuildNotifications(): void {

    const preferences = this.getPreferences();

    const results: CustomerNotification[] = [];

    for (const order of this.customerOrders) {

      const productName =
        order.items?.[0]?.name || 'SilkMart products';

      const count = order.items?.reduce(
        (sum, item) =>
          sum + Number(item.quantity || 0),
        0
      ) ?? 0;

      const createdAt = this.toMillis(
        order.createdAt
      );

      const updatedAt = this.toMillis(
        order.updatedAt
      );

      const placedId = `placed:${order.id}`;

      results.push({
        id: placedId,
        type: 'order',
        icon: 'pi pi-shopping-bag',
        title: 'Order placed successfully',
        message:
          `Your order for ${count} item(s), including ` +
          `${productName}, has been received. ` +
          `Your preferred delivery date is ` +
          `${this.formatDeliveryDate(
            order.preferredDeliveryDate
          )}. Awaiting staff confirmation.`,
        time: this.formatTimestamp(order.createdAt),
        read: preferences[placedId]?.read === true,
        actionLabel: 'View order',
        sortTime: createdAt,
        orderId: order.id
      });

      const status = String(
        order.status || 'Pending'
      );

      if (status !== 'Pending') {

        const statusId =
          `status:${status}:${order.id}`;

        const statusMessages: Record<
          string,
          {
            title: string;
            message: string;
            icon: string;
          }
        > = {

          Confirmed: {
            title: 'Order confirmed',
            message:
              `Your order for ${productName} ` +
              'has been confirmed by SilkMart staff.',
            icon: 'pi pi-check-circle'
          },

          Rejected: {
            title: 'Order rejected',
            message:
              `Your order for ${productName} ` +
              'was not approved. Contact staff for assistance.',
            icon: 'pi pi-times-circle'
          },

          Cancelled: {
            title: 'Order cancelled',
            message:
              `Your order for ${productName} ` +
              'has been cancelled.',
            icon: 'pi pi-ban'
          },

          Delivered: {
            title: 'Order delivered',
            message:
              `Your order for ${productName} ` +
              'has been marked delivered.',
            icon: 'pi pi-box'
          }
        };

        const info = statusMessages[status];

        if (info) {

          results.push({
            id: statusId,
            type: 'order',
            icon: info.icon,
            title: info.title,
            message: info.message,
            time: this.formatTimestamp(
              order.updatedAt
            ),
            read:
              preferences[statusId]?.read === true,
            actionLabel: 'View order',
            sortTime: updatedAt || createdAt,
            orderId: order.id
          });
        }
      }
    }

    this.notifications = results
      .filter(
        item => !preferences[item.id]?.deleted
      )
      .sort(
        (a, b) => b.sortTime - a.sortTime
      );
  }

  // =========================================
  // LIVE CHAT BADGE LISTENERS
  // =========================================

  private syncChatListeners(session: number): void {

    const orderIds = new Set(
      this.customerOrders.map(order => order.id)
    );

    // Remove listeners for deleted orders.
    for (const [orderId, subscription]
      of this.chatListeners.entries()) {

      if (!orderIds.has(orderId)) {
        subscription.unsubscribe();

        this.chatListeners.delete(orderId);

        delete this.messagesByOrder[orderId];
        delete this.unreadChatsByOrder[orderId];
      }
    }

    // Subscribe to orders not yet monitored.
    for (const order of this.customerOrders) {

      if (this.chatListeners.has(order.id)) {
        continue;
      }

      const orderId = order.id;

      const subscription = runInInjectionContext(
        this.injector,

        () => this.chatService.getMessages(orderId)
          .subscribe({

            next: messages => {
              this.zone.run(() => {

                if (
                  session !== this.accountSession ||
                  !this.currentUserId
                ) {
                  return;
                }

                this.messagesByOrder[orderId] = messages;

                // An open chat means the customer
                // is viewing those messages.
                if (
                  this.showChatPopup &&
                  this.selectedChatOrder?.id === orderId
                ) {

                  this.chatMessages = messages;

                  this.chatLoading = false;

                  this.markOrderChatAsRead(orderId);

                } else {

                  this.calculateUnreadForOrder(orderId);
                }

                this.refreshUI();
              });
            },

            error: error => {
              this.zone.run(() => {

                console.error(
                  `Unable to load messages for ${orderId}:`,
                  error
                );

                if (
                  this.selectedChatOrder?.id === orderId &&
                  this.showChatPopup
                ) {
                  this.chatLoading = false;
                  this.chatError =
                    'Unable to load conversation.';
                }

                this.refreshUI();
              });
            }
          })
      );

      this.chatListeners.set(
        orderId,
        subscription
      );
    }
  }

  private stopAllChatListeners(): void {

    for (const subscription of
      this.chatListeners.values()) {

      subscription.unsubscribe();
    }

    this.chatListeners.clear();
  }

  // =========================================
  // CHAT READ STATE
  // =========================================

  private getSeenChatsStorageKey(): string {

    return (
      'silkmart_seen_chat_messages:' +
      this.currentUserId
    );
  }

  private loadSeenChatMessages(): SeenChatMessages {

    if (!this.currentUserId) return {};

    try {

      const stored = localStorage.getItem(
        this.getSeenChatsStorageKey()
      );

      const parsed = stored
        ? JSON.parse(stored)
        : {};

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return {};
      }

      const result: SeenChatMessages = {};

      for (const [orderId, messageIds] of
        Object.entries(parsed)) {

        if (Array.isArray(messageIds)) {

          result[orderId] = messageIds.filter(
            id => typeof id === 'string'
          );
        }
      }

      return result;

    } catch {
      return {};
    }
  }

  private saveSeenChatMessages(): void {

    if (!this.currentUserId) return;

    try {
      localStorage.setItem(
        this.getSeenChatsStorageKey(),
        JSON.stringify(this.seenChatMessages)
      );
    } catch (error) {
      console.error(
        'Unable to save chat read state:',
        error
      );
    }
  }

  private calculateUnreadForOrder(
    orderId: string
  ): void {

    const messages =
      this.messagesByOrder[orderId] || [];

    const seen = new Set(
      this.seenChatMessages[orderId] || []
    );

    const unread = messages.filter(
      message =>
        message.senderRole === 'staff' &&
        !!message.id &&
        !seen.has(message.id)
    ).length;

    this.unreadChatsByOrder[orderId] = unread;
  }

  private markOrderChatAsRead(
    orderId: string
  ): void {

    const messages =
      this.messagesByOrder[orderId] || [];

    const seen = new Set(
      this.seenChatMessages[orderId] || []
    );

    let changed = false;

    for (const message of messages) {

      // Only incoming staff messages
      // need to be marked as read.
      if (
        message.senderRole === 'staff' &&
        message.id &&
        !seen.has(message.id)
      ) {

        seen.add(message.id);
        changed = true;
      }
    }

    if (changed) {

      this.seenChatMessages[orderId] = [
        ...seen
      ];

      this.saveSeenChatMessages();
    }

    this.calculateUnreadForOrder(orderId);
  }

  get unreadChatCount(): number {

    return Object.values(
      this.unreadChatsByOrder
    ).reduce(
      (sum, count) => sum + count,
      0
    );
  }

  getUnreadChatCount(
    orderId: string
  ): number {

    return this.unreadChatsByOrder[orderId] || 0;
  }

  private handleStorageChange = (
    event: StorageEvent
  ): void => {

    if (
      !this.currentUserId ||
      event.key !== this.getSeenChatsStorageKey()
    ) {
      return;
    }

    this.zone.run(() => {

      this.seenChatMessages =
        this.loadSeenChatMessages();

      for (const order of this.customerOrders) {
        this.calculateUnreadForOrder(order.id);
      }

      this.refreshUI();
    });
  };

  // =========================================
  // ORDER NOTIFICATION HELPERS
  // =========================================

  private toMillis(value: any): number {

    if (!value) return 0;

    if (typeof value.toMillis === 'function') {
      return value.toMillis();
    }

    if (typeof value.seconds === 'number') {
      return value.seconds * 1000;
    }

    const date = new Date(value).getTime();

    return Number.isFinite(date) ? date : 0;
  }

  private formatTimestamp(value: any): string {

    const timestamp = this.toMillis(value);

    if (!timestamp) return 'Just now';

    return new Date(timestamp).toLocaleString(
      'en-PH',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }
    );
  }

  private formatDeliveryDate(value: string): string {

    if (!value) return 'not yet specified';

    const parts = value.split('-');

    if (parts.length === 3) {

      const date = new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
      );

      if (!Number.isNaN(date.getTime())) {

        return date.toLocaleDateString(
          'en-PH',
          {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          }
        );
      }
    }

    return value;
  }

  // =========================================
  // ORDER NOTIFICATION PREFERENCES
  // =========================================

  private preferencesKey(): string {

    return (
      'silkNotificationState:' +
      this.currentUserId
    );
  }

  private getPreferences(): Record<
    string,
    NotificationPreference
  > {

    try {

      return JSON.parse(
        localStorage.getItem(
          this.preferencesKey()
        ) || '{}'
      );

    } catch {
      return {};
    }
  }

  private savePreferences(
    data: Record<string, NotificationPreference>
  ): void {

    try {

      localStorage.setItem(
        this.preferencesKey(),
        JSON.stringify(data)
      );

    } catch (error) {
      console.error(
        'Notification preference error:',
        error
      );
    }
  }

  // =========================================
  // FILTERS
  // =========================================

  get unreadCount(): number {

    return this.notifications.filter(
      item => !item.read
    ).length;
  }

  get orderCount(): number {

    return this.notifications.length;
  }

  get filteredNotifications():
    CustomerNotification[] {

    if (this.selectedFilter === 'unread') {

      return this.notifications.filter(
        item => !item.read
      );
    }

    if (this.selectedFilter === 'chat') {
      return [];
    }

    return this.notifications;
  }

  setFilter(filter: NotificationFilter): void {

    this.selectedFilter = filter;
  }

  // =========================================
  // MARK ORDER NOTIFICATIONS READ
  // =========================================

  markAsRead(item: CustomerNotification): void {

    item.read = true;

    const preferences = this.getPreferences();

    preferences[item.id] = {
      read: true,
      deleted:
        preferences[item.id]?.deleted === true
    };

    this.savePreferences(preferences);
  }

  markAllAsRead(): void {

    const preferences = this.getPreferences();

    for (const item of this.notifications) {

      item.read = true;

      preferences[item.id] = {
        read: true,
        deleted: false
      };
    }

    this.savePreferences(preferences);
  }

  openNotification(item: CustomerNotification): void {

    this.markAsRead(item);

    this.router.navigate([
      '/home-cust/order'
    ]);
  }

  // =========================================
  // DELETE ORDER NOTIFICATION
  // =========================================

  openDeleteConfirmation(
    item: CustomerNotification
  ): void {

    this.selectedDeleteNotification = item;
    this.deleteConfirmPopup = true;
  }

  closeDeleteConfirmation(): void {

    this.deleteConfirmPopup = false;
    this.selectedDeleteNotification = null;
  }

  confirmDeleteNotification(): void {

    if (!this.selectedDeleteNotification) return;

    const id = this.selectedDeleteNotification.id;

    const preferences = this.getPreferences();

    preferences[id] = {
      read: true,
      deleted: true
    };

    this.savePreferences(preferences);

    this.notifications = this.notifications.filter(
      item => item.id !== id
    );

    this.closeDeleteConfirmation();
  }

  // =========================================
  // OPEN CUSTOMER CHAT
  // =========================================

  openChat(order: SilkMartOrder): void {

    this.closeChat(true);

    this.selectedChatOrder = order;

    this.showChatPopup = true;
    this.chatError = '';
    this.chatInput = '';

    const messages =
      this.messagesByOrder[order.id];

    if (messages) {

      this.chatMessages = [...messages];

      this.chatLoading = false;

      this.markOrderChatAsRead(order.id);

    } else {

      this.chatMessages = [];
      this.chatLoading = true;
    }

    this.refreshUI();
  }

  // =========================================
  // CLOSE CUSTOMER CHAT
  // =========================================

  closeChat(force = false): void {

    if (this.chatSaving && !force) return;

    this.chatSub?.unsubscribe();
    this.chatSub = null;

    this.showChatPopup = false;
    this.selectedChatOrder = null;

    this.chatMessages = [];
    this.chatInput = '';

    this.chatError = '';
    this.chatLoading = false;
  }

  // =========================================
  // SEND CHAT MESSAGE
  // =========================================

  async sendChatMessage(): Promise<void> {

    if (
      !this.selectedChatOrder ||
      this.chatSaving ||
      !this.chatInput.trim()
    ) {
      return;
    }

    const orderId = this.selectedChatOrder.id;
    const text = this.chatInput.trim();

    this.chatSaving = true;
    this.chatError = '';

    this.refreshUI();

    try {

      await this.chatService.sendMessage(
        orderId,
        text,
        'customer'
      );

      this.zone.run(() => {

        if (this.selectedChatOrder?.id === orderId) {
          this.chatInput = '';
        }

        this.refreshUI();
      });

    } catch (error: any) {

      this.zone.run(() => {

        console.error(
          'Sending chat failed:',
          error
        );

        this.chatError =
          error?.code === 'permission-denied'
            ? 'Firebase denied this message. Check your chat rules.'
            : error?.message ||
              'Unable to send message.';

        this.refreshUI();
      });

    } finally {

      this.zone.run(() => {

        this.chatSaving = false;
        this.refreshUI();
      });
    }
  }

  formatChatTime(value: any): string {

    const timestamp = this.toMillis(value);

    if (!timestamp) return 'Sending...';

    return new Date(timestamp).toLocaleTimeString(
      'en-PH',
      {
        hour: 'numeric',
        minute: '2-digit'
      }
    );
  }

  isMyMessage(
    message: OrderChatMessage
  ): boolean {

    return message.senderUid === this.currentUserId;
  }

  getChatProductName(
    order: SilkMartOrder
  ): string {

    return order.items?.[0]?.name ||
      'SilkMart Order';
  }

  trackMessage(
    index: number,
    message: OrderChatMessage
  ): string {

    return message.id ||
      `${message.senderUid}-${index}`;
  }
}
