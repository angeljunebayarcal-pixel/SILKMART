
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

import {
  Subscription,
  filter
} from 'rxjs';

// =========================================
// TYPES
// =========================================

interface NotificationPreference {
  read?: boolean;
  deleted?: boolean;
}

type SeenChatMessages = Record<string, string[]>;

// =========================================
// CUSTOMER TOPBAR
// =========================================

@Component({
  selector: 'app-topbar-cust',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './topbar-cust.html',
  styleUrls: ['./topbar-cust.scss']
})
export class TopbarCust implements OnInit, OnDestroy {

  // =========================================
  // NOTIFICATION COUNTS
  // =========================================

  notificationCount = 0;

  orderNotificationCount = 0;

  chatNotificationCount = 0;

  private currentUserId = '';

  private firebaseOrders: SilkMartOrder[] = [];

  private messagesByOrder:
    Record<string, OrderChatMessage[]> = {};

  private chatListeners =
    new Map<string, Subscription>();

  private accountSession = 0;

  // =========================================
  // CUSTOMER PROFILE
  // =========================================

  profileInitial = 'C';

  profileImageUrl = '';

  // =========================================
  // MENU
  // =========================================

  menuOpen = false;

  // =========================================
  // SUBSCRIPTIONS
  // =========================================

  private stopProfileListener:
    (() => void) | null = null;

  private stopAuthListener:
    (() => void) | null = null;

  private routerSubscription:
    Subscription | null = null;

  private ordersSubscription:
    Subscription | null = null;

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private router: Router,
    private auth: Auth,
    private userService: UserServ,
    private cdr: ChangeDetectorRef,
    private injector: Injector,
    private zone: NgZone,
    private orderService: OrderServ,
    private chatService: OrderChatServ
  ) {}

  // =========================================
  // INITIALIZATION
  // =========================================

  ngOnInit(): void {

    this.listenToAuthUser();

    this.routerSubscription = this.router.events
      .pipe(
        filter(
          event => event instanceof NavigationEnd
        )
      )
      .subscribe(() => {
        this.updateNotificationCount();
      });

    // Detect read state changes from other tabs.
    window.addEventListener(
      'storage',
      this.handleStorageChange
    );

    // Update the badge after returning to the tab.
    window.addEventListener(
      'focus',
      this.handleWindowFocus
    );

    // Update immediately when the customer
    // clicks notification or chat controls.
    document.addEventListener(
      'click',
      this.handlePageClick
    );
  }

  // =========================================
  // AUTHENTICATION
  // =========================================

  private listenToAuthUser(): void {

    this.stopAuthListener = runInInjectionContext(
      this.injector,

      () => onAuthStateChanged(
        this.auth,

        user => {

          this.zone.run(() => {

            this.accountSession++;

            // Remove listeners from the old account.
            this.ordersSubscription?.unsubscribe();
            this.ordersSubscription = null;

            this.stopAllChatListeners();

            if (this.stopProfileListener) {
              this.stopProfileListener();
              this.stopProfileListener = null;
            }

            this.firebaseOrders = [];
            this.messagesByOrder = {};

            this.notificationCount = 0;
            this.orderNotificationCount = 0;
            this.chatNotificationCount = 0;

            if (!user) {

              this.currentUserId = '';
              this.profileInitial = 'C';
              this.profileImageUrl = '';

              this.refreshUI();
              return;
            }

            this.currentUserId = user.uid;

            this.listenToProfile(user.uid);

            this.listenToFirebaseOrders();

            this.refreshUI();
          });
        },

        error => {

          this.zone.run(() => {

            console.error(
              'Topbar authentication error:',
              error
            );

            this.notificationCount = 0;
            this.refreshUI();
          });
        }
      )
    );
  }

  // =========================================
  // LIVE CUSTOMER PROFILE
  // =========================================

  private listenToProfile(uid: string): void {

    this.stopProfileListener =
      this.userService.listenToUserProfile(
        uid,

        (profile: UserProfile | null) => {

          this.zone.run(() => {

            if (!profile) {

              this.profileInitial = 'C';
              this.profileImageUrl = '';

              this.refreshUI();
              return;
            }

            const name =
              profile.fullName?.trim() ?? '';

            this.profileInitial = name
              ? name.charAt(0).toUpperCase()
              : 'C';

            this.profileImageUrl =
              profile.profileImageUrl ?? '';

            this.refreshUI();
          });
        }
      );
  }

  // =========================================
  // LIVE FIRESTORE ORDERS
  // =========================================

  private listenToFirebaseOrders(): void {

    if (!this.currentUserId) return;

    const uid = this.currentUserId;
    const session = this.accountSession;

    this.ordersSubscription?.unsubscribe();

    this.ordersSubscription = runInInjectionContext(
      this.injector,

      () => this.orderService.getMyOrders()
        .subscribe({

          next: orders => {

            this.zone.run(() => {

              if (
                session !== this.accountSession ||
                uid !== this.currentUserId
              ) {
                return;
              }

              this.firebaseOrders = orders.filter(
                order => order.customerId === uid
              );

              // Subscribe to order conversations.
              this.syncChatListeners(session);

              this.updateNotificationCount();
            });
          },

          error: error => {

            this.zone.run(() => {

              console.error(
                'Unable to load topbar orders:',
                error
              );

              this.firebaseOrders = [];

              this.stopAllChatListeners();
              this.messagesByOrder = {};

              this.updateNotificationCount();
            });
          }
        })
    );
  }

  // =========================================
  // CHAT LISTENERS
  // =========================================

  private syncChatListeners(session: number): void {

    const orderIds = new Set(
      this.firebaseOrders.map(order => order.id)
    );

    // Stop listening to removed orders.
    for (const [orderId, subscription]
      of this.chatListeners.entries()) {

      if (!orderIds.has(orderId)) {

        subscription.unsubscribe();
        this.chatListeners.delete(orderId);

        delete this.messagesByOrder[orderId];
      }
    }

    // Start listening to newly available orders.
    for (const order of this.firebaseOrders) {

      if (this.chatListeners.has(order.id)) {
        continue;
      }

      const orderId = order.id;
      const uid = this.currentUserId;

      const subscription = runInInjectionContext(
        this.injector,

        () => this.chatService.getMessages(orderId)
          .subscribe({

            next: messages => {

              this.zone.run(() => {

                if (
                  session !== this.accountSession ||
                  uid !== this.currentUserId
                ) {
                  return;
                }

                this.messagesByOrder[orderId] =
                  messages;

                this.updateNotificationCount();
              });
            },

            error: error => {

              console.error(
                'Topbar chat listener error:',
                error
              );

              this.zone.run(() => {

                delete this.messagesByOrder[orderId];

                this.updateNotificationCount();
              });
            }
          })
      );

      this.chatListeners.set(orderId, subscription);
    }
  }

  private stopAllChatListeners(): void {

    for (const subscription
      of this.chatListeners.values()) {

      subscription.unsubscribe();
    }

    this.chatListeners.clear();
  }

  // =========================================
  // ORDER NOTIFICATION PREFERENCES
  // =========================================

  private getNotificationStorageKey(): string {

    return (
      'silkNotificationState:' +
      this.currentUserId
    );
  }

  private getNotificationPreferences():
    Record<string, NotificationPreference> {

    if (!this.currentUserId) return {};

    try {

      const stored = localStorage.getItem(
        this.getNotificationStorageKey()
      );

      const parsed = stored
        ? JSON.parse(stored)
        : {};

      return parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
          ? parsed
          : {};

    } catch {
      return {};
    }
  }

  private isNotificationUnread(
    id: string,
    preferences:
      Record<string, NotificationPreference>
  ): boolean {

    return (
      preferences[id]?.read !== true &&
      preferences[id]?.deleted !== true
    );
  }

  // =========================================
  // CHAT READ PREFERENCES
  // =========================================

  // IMPORTANT:
  // This matches the storage key used by
  // notif-cust.ts to mark chat messages read.

  private getSeenChatsStorageKey(): string {

    return (
      'silkmart_seen_chat_messages:' +
      this.currentUserId
    );
  }

  private getSeenChatMessages(): SeenChatMessages {

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

      const seen: SeenChatMessages = {};

      for (const [orderId, ids]
        of Object.entries(parsed)) {

        if (Array.isArray(ids)) {

          seen[orderId] = ids.filter(
            id => typeof id === 'string'
          );
        }
      }

      return seen;

    } catch {
      return {};
    }
  }

  // =========================================
  // COUNT UNREAD ORDER NOTIFICATIONS
  // =========================================

  private countUnreadOrders(): number {

    const preferences =
      this.getNotificationPreferences();

    let unread = 0;

    for (const order of this.firebaseOrders) {

      const placedId = `placed:${order.id}`;

      if (
        this.isNotificationUnread(
          placedId,
          preferences
        )
      ) {
        unread++;
      }

      const status = String(
        order.status || 'Pending'
      );

      if (
        [
          'Confirmed',
          'Rejected',
          'Cancelled',
          'Delivered'
        ].includes(status)
      ) {

        const statusId =
          `status:${status}:${order.id}`;

        if (
          this.isNotificationUnread(
            statusId,
            preferences
          )
        ) {
          unread++;
        }
      }
    }

    return unread;
  }

  // =========================================
  // COUNT UNREAD STAFF MESSAGES
  // =========================================

  private countUnreadChats(): number {

    const seenChats =
      this.getSeenChatMessages();

    let unread = 0;

    for (const order of this.firebaseOrders) {

      const messages =
        this.messagesByOrder[order.id] || [];

      const seenIds = new Set(
        seenChats[order.id] || []
      );

      for (const message of messages) {

        // Only messages sent by Admin/Staff
        // are counted for the customer.

        if (
          message.senderRole === 'staff' &&
          !!message.id &&
          !seenIds.has(message.id)
        ) {
          unread++;
        }
      }
    }

    return unread;
  }

  // =========================================
  // UPDATE TOPBAR BELL
  // =========================================

  updateNotificationCount(): void {

    if (!this.currentUserId) {

      this.orderNotificationCount = 0;
      this.chatNotificationCount = 0;
      this.notificationCount = 0;

      this.refreshUI();
      return;
    }

    this.orderNotificationCount =
      this.countUnreadOrders();

    this.chatNotificationCount =
      this.countUnreadChats();

    this.notificationCount =
      this.orderNotificationCount +
      this.chatNotificationCount;

    this.refreshUI();
  }

  // =========================================
  // STORAGE CHANGE DETECTION
  // =========================================

  private handleStorageChange = (
    event: StorageEvent
  ): void => {

    if (!this.currentUserId) return;

    if (
      event.key ===
        this.getNotificationStorageKey() ||
      event.key ===
        this.getSeenChatsStorageKey()
    ) {

      this.zone.run(() => {
        this.updateNotificationCount();
      });
    }
  };

  private handleWindowFocus = (): void => {

    this.updateNotificationCount();
  };

  private handlePageClick = (): void => {

    // Notification page writes read states
    // during click handling. Recheck after
    // the button action finishes.

    queueMicrotask(() => {
      this.updateNotificationCount();
    });
  };

  // =========================================
  // MENU
  // =========================================

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  // =========================================
  // NOTIFICATIONS PAGE
  // =========================================

  openNotifications(): void {

    this.closeMenu();

    this.router.navigate([
      '/home-cust/notif-cust'
    ]);
  }

  // =========================================
  // PROFILE PAGE
  // =========================================

  openProfile(): void {

    this.closeMenu();

    this.router.navigate([
      '/home-cust/profile'
    ]);
  }

  // =========================================
  // REFRESH VIEW
  // =========================================

  private refreshUI(): void {
    this.cdr.detectChanges();
  }

  // =========================================
  // CLEANUP
  // =========================================

  ngOnDestroy(): void {

    this.accountSession++;

    this.ordersSubscription?.unsubscribe();
    this.ordersSubscription = null;

    this.stopAllChatListeners();

    if (this.stopProfileListener) {
      this.stopProfileListener();
      this.stopProfileListener = null;
    }

    this.stopAuthListener?.();
    this.stopAuthListener = null;

    this.routerSubscription?.unsubscribe();

    window.removeEventListener(
      'storage',
      this.handleStorageChange
    );

    window.removeEventListener(
      'focus',
      this.handleWindowFocus
    );

    document.removeEventListener(
      'click',
      this.handlePageClick
    );
  }
}
