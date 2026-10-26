
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

import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive
} from '@angular/router';

import {
  Auth,
  onAuthStateChanged
} from '@angular/fire/auth';

import { Subscription, filter } from 'rxjs';

import {
  UserServ,
  UserProfile
} from '../../../services/user.serv';

import {
  OrderServ,
  SilkMartOrder
} from '../../../services/order.serv';

import {
  OrderChatServ,
  OrderChatMessage
} from '../../../services/order-chat.serv';

interface NotificationPreference {
  read?: boolean;
  deleted?: boolean;
  lastSeenMessageId?: string;
  deletedMessageId?: string;
}

@Component({
  selector: 'app-topbar-adm',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './topbar-adm.html',
  styleUrl: './topbar-adm.scss'
})
export class TopbarAdm implements OnInit, OnDestroy {

  notificationCount = 0;

  profileInitial = 'A';
  profileImageUrl = '';

  menuOpen = false;

  private currentUserId = '';

  private currentOrders: SilkMartOrder[] = [];

  private messagesByOrder:
    Record<string, OrderChatMessage[]> = {};

  private stopProfileListener:
    (() => void) | null = null;

  private stopAuthListener:
    (() => void) | null = null;

  private ordersSubscription: Subscription | null = null;
  private routeSubscription: Subscription | null = null;

  private chatSubscriptions =
    new Map<string, Subscription>();

  private reminderTimer:
    ReturnType<typeof setInterval> | null = null;

  private accountSession = 0;

  constructor(
    private router: Router,
    private auth: Auth,
    private userService: UserServ,
    private orderService: OrderServ,
    private chatService: OrderChatServ,
    private cdr: ChangeDetectorRef,
    private injector: Injector,
    private zone: NgZone
  ) {}

  ngOnInit(): void {
    this.listenToAuthUser();

    this.routeSubscription = this.router.events
      .pipe(
        filter(
          event => event instanceof NavigationEnd
        )
      )
      .subscribe(() => {
        this.updateNotificationCount();
      });

    window.addEventListener(
      'storage',
      this.handleStorageChange
    );

    window.addEventListener(
      'focus',
      this.handleWindowFocus
    );

    // React immediately when a notification
    // is read or deleted in the same browser tab.
    window.addEventListener(
      'silkmart-admin-notifications-changed',
      this.handleNotificationsChanged
    );

    // Refresh date-based reminders
    // if this page remains open overnight.
    this.reminderTimer = setInterval(() => {
      this.zone.run(() => {
        this.updateNotificationCount();
      });
    }, 60_000);
  }

  private listenToAuthUser(): void {
    this.stopAuthListener = runInInjectionContext(
      this.injector,
      () => onAuthStateChanged(
        this.auth,
        user => {
          this.zone.run(() => {

            this.accountSession++;
            this.stopDataListeners();

            this.stopProfileListener?.();
            this.stopProfileListener = null;

            this.currentUserId = user?.uid ?? '';

            this.profileInitial = 'A';
            this.profileImageUrl = '';

            this.notificationCount = 0;
            this.currentOrders = [];
            this.messagesByOrder = {};

            if (user) {
              this.listenToProfile(user.uid);
              this.listenToOrders(this.accountSession);
            }

            this.refresh();
          });
        }
      )
    );
  }

  private listenToProfile(uid: string): void {
    this.stopProfileListener =
      this.userService.listenToUserProfile(
        uid,
        (profile: UserProfile | null) => {
          this.zone.run(() => {

            if (!profile) {
              this.profileInitial = 'A';
              this.profileImageUrl = '';
              this.refresh();
              return;
            }

            const name =
              profile.fullName?.trim() ?? '';

            this.profileInitial = name
              ? name.charAt(0).toUpperCase()
              : 'A';

            this.profileImageUrl =
              profile.profileImageUrl ?? '';

            this.refresh();
          });
        }
      );
  }

  private listenToOrders(session: number): void {
    this.ordersSubscription = runInInjectionContext(
      this.injector,
      () => this.orderService.getAllOrders().subscribe({
        next: orders => {
          this.zone.run(() => {

            if (session !== this.accountSession) {
              return;
            }

            this.currentOrders = orders;

            this.syncChatListeners(session);
            this.updateNotificationCount();
          });
        },

        error: error => {
          console.error(
            'Unable to load Admin notifications:',
            error
          );

          this.zone.run(() => {
            if (session !== this.accountSession) {
              return;
            }

            this.currentOrders = [];
            this.notificationCount = 0;
            this.refresh();
          });
        }
      })
    );
  }

  private syncChatListeners(session: number): void {
    const activeOrderIds = new Set(
      this.currentOrders.map(order => order.id)
    );

    // Stop listening to removed orders.
    for (const [orderId, subscription] of
      this.chatSubscriptions.entries()) {

      if (!activeOrderIds.has(orderId)) {
        subscription.unsubscribe();

        this.chatSubscriptions.delete(orderId);
        delete this.messagesByOrder[orderId];
      }
    }

    // Listen for incoming customer messages.
    for (const order of this.currentOrders) {
      if (this.chatSubscriptions.has(order.id)) {
        continue;
      }

      const orderId = order.id;

      const subscription = runInInjectionContext(
        this.injector,
        () => this.chatService.getMessages(orderId)
          .subscribe({
            next: messages => {
              this.zone.run(() => {

                if (session !== this.accountSession) {
                  return;
                }

                this.messagesByOrder[orderId] = messages;

                this.updateNotificationCount();
              });
            },

            error: error => {
              console.error(
                'Unable to read customer chat:',
                orderId,
                error
              );
            }
          })
      );

      this.chatSubscriptions.set(
        orderId,
        subscription
      );
    }
  }

  private preferencesKey(): string {
    return (
      'silkmart_admin_notifications:' +
      this.currentUserId
    );
  }

  private getPreferences():
    Record<string, NotificationPreference> {

    if (!this.currentUserId) {
      return {};
    }

    try {
      const stored = localStorage.getItem(
        this.preferencesKey()
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

      return parsed;

    } catch {
      return {};
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

  // Match the notification page:
  // only the latest customer message in each
  // order conversation determines unread status.
  private latestCustomerMessage(
    orderId: string
  ): OrderChatMessage | null {

    const customerMessages = (
      this.messagesByOrder[orderId] || []
    ).filter(message =>
      message.senderRole === 'customer' &&
      !!message.id
    );

    if (!customerMessages.length) {
      return null;
    }

    return [...customerMessages].sort((a, b) => {
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

  private updateNotificationCount(): void {
    if (!this.currentUserId) {
      this.notificationCount = 0;
      this.refresh();
      return;
    }

    const preferences = this.getPreferences();
    const unreadIds = new Set<string>();

    const addIfUnread = (id: string): void => {
      if (
        preferences[id]?.read !== true &&
        preferences[id]?.deleted !== true
      ) {
        unreadIds.add(id);
      }
    };

    const today = this.localDate(new Date());
    const tomorrow = this.tomorrow();

    for (const order of this.currentOrders) {
      const raw = order as SilkMartOrder & {
        scheduledDeliveryDate?: string;
        deliveryStatus?: string;
      };

      // New order notification.
      addIfUnread(`new-order:${order.id}`);

      const status = String(
        order.status || 'Pending'
      );

      const scheduledDate =
        raw.scheduledDeliveryDate || '';

      const deliveryStatus =
        String(raw.deliveryStatus || '');

      // Confirmed order awaiting scheduling.
      if (
        status === 'Confirmed' &&
        !scheduledDate &&
        deliveryStatus !== 'Cancelled' &&
        deliveryStatus !== 'Delivered'
      ) {
        addIfUnread(
          `schedule-required:${order.id}`
        );
      }

      const reminderEligible =
        status === 'Confirmed' &&
        (
          deliveryStatus === 'Scheduled' ||
          deliveryStatus === 'Preparing'
        );

      // Day-before reminder.
      if (
        reminderEligible &&
        scheduledDate === tomorrow
      ) {
        addIfUnread(
          `dispatch-tomorrow:${order.id}:${scheduledDate}`
        );
      }

      // Delivery-day reminder.
      if (
        reminderEligible &&
        scheduledDate === today
      ) {
        addIfUnread(
          `dispatch-today:${order.id}:${scheduledDate}`
        );
      }

      // Only ONE unread chat notification per order.
      const latestMessage =
        this.latestCustomerMessage(order.id);

      if (latestMessage?.id) {
        const id = `customer-chat:${order.id}`;
        const preference = preferences[id] || {};

        const alreadyRead =
          preference.lastSeenMessageId ===
          latestMessage.id;

        const hiddenForLatestMessage =
          preference.deleted === true &&
          preference.deletedMessageId ===
            latestMessage.id;

        if (
          !alreadyRead &&
          !hiddenForLatestMessage
        ) {
          unreadIds.add(id);
        }
      }
    }

    this.notificationCount = unreadIds.size;
    this.refresh();
  }

  private handleStorageChange = (
    event: StorageEvent
  ): void => {

    if (
      this.currentUserId &&
      event.key === this.preferencesKey()
    ) {
      this.zone.run(() => {
        this.updateNotificationCount();
      });
    }
  };

  private handleWindowFocus = (): void => {
    this.zone.run(() => {
      this.updateNotificationCount();
    });
  };

  // Same-tab immediate update.
  private handleNotificationsChanged = (): void => {
    this.zone.run(() => {
      this.updateNotificationCount();
    });
  };

  private refresh(): void {
    this.cdr.detectChanges();
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  openNotifications(): void {
    this.closeMenu();

    this.router.navigate([
      '/home-adm/notf-adm'
    ]);
  }

  openProfile(): void {
    this.closeMenu();

    this.router.navigate([
      '/home-adm/profile-adm'
    ]);
  }

  private stopDataListeners(): void {
    this.ordersSubscription?.unsubscribe();
    this.ordersSubscription = null;

    for (const subscription of
      this.chatSubscriptions.values()) {
      subscription.unsubscribe();
    }

    this.chatSubscriptions.clear();
  }

  ngOnDestroy(): void {
    this.accountSession++;

    this.stopDataListeners();

    this.stopProfileListener?.();
    this.stopProfileListener = null;

    this.stopAuthListener?.();
    this.stopAuthListener = null;

    this.routeSubscription?.unsubscribe();

    if (this.reminderTimer) {
      clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }

    window.removeEventListener(
      'storage',
      this.handleStorageChange
    );

    window.removeEventListener(
      'focus',
      this.handleWindowFocus
    );

    window.removeEventListener(
      'silkmart-admin-notifications-changed',
      this.handleNotificationsChanged
    );
  }
}
