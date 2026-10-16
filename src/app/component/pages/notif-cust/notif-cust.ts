import {
  CommonModule
} from '@angular/common';

import {
  Component
} from '@angular/core';

import {
  Router
} from '@angular/router';


type NotificationFilter =
  | 'all'
  | 'unread'
  | 'orders';


type NotificationAction =
  | 'order'
  | 'collection'
  | null;


interface CustomerNotification {

  id: number;

  type:
    | 'order'
    | 'profile'
    | 'collection';

  icon: string;

  title: string;

  message: string;

  time: string;

  read: boolean;

  actionLabel?: string;

  action?: NotificationAction;

}


@Component({
  selector: 'app-notif-cust',

  standalone: true,

  imports: [
    CommonModule
  ],

  templateUrl: './notif-cust.html',

  styleUrl: './notif-cust.scss',
})
export class NotifCust {


  // =========================================
  // FILTER
  // =========================================

  selectedFilter:
    NotificationFilter =
    'all';


  // =========================================
  // DELETE CONFIRMATION
  // =========================================

  deleteConfirmPopup =
    false;


  selectedDeleteNotification:
    CustomerNotification | null =
    null;


  // =========================================
  // NOTIFICATIONS
  // =========================================

  notifications:
    CustomerNotification[] = [

    {
      id: 1,

      type: 'order',

      icon:
        'pi pi-shopping-bag',

      title:
        'Order placed successfully',

      message:
        'Your SilkMart order has been placed successfully. Thank you for shopping with SilkMart!',

      time:
        '2 minutes ago',

      read:
        false,

      actionLabel:
        'View order',

      action:
        'order'
    },

    {
      id: 2,

      type: 'order',

      icon:
        'pi pi-cog',

      title:
        'Your order is processing',

      message:
        'We are preparing your silk items for shipment. Your order is now being processed.',

      time:
        '1 hour ago',

      read:
        false,

      actionLabel:
        'View order',

      action:
        'order'
    },

    {
      id: 3,

      type: 'order',

      icon:
        'pi pi-truck',

      title:
        'Your order has been shipped',

      message:
        'Good news! Your SilkMart order has been shipped and is on its way to you.',

      time:
        '1 day ago',

      read:
        true,

      actionLabel:
        'View order',

      action:
        'order'
    },

    {
      id: 4,

      type: 'profile',

      icon:
        'pi pi-user',

      title:
        'Profile updated',

      message:
        'Your profile information has been updated successfully.',

      time:
        '3 days ago',

      read:
        true,

      action:
        null
    },

    {
      id: 5,

      type: 'collection',

      icon:
        'pi pi-gift',

      title:
        'A new collection has arrived',

      message:
        'Discover our latest Home & Sleep collection — elegant silks for a more peaceful everyday.',

      time:
        '5 days ago',

      read:
        true,

      actionLabel:
        'View collection',

      action:
        'collection'
    }

  ];


  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private router: Router
  ) {}


  // =========================================
  // UNREAD COUNT
  // =========================================

  get unreadCount():
    number {

    return this.notifications
      .filter(
        notification =>
          !notification.read
      )
      .length;

  }


  // =========================================
  // ORDER COUNT
  // =========================================

  get orderCount():
    number {

    return this.notifications
      .filter(
        notification =>
          notification.type ===
          'order'
      )
      .length;

  }


  // =========================================
  // FILTERED NOTIFICATIONS
  // =========================================

  get filteredNotifications():
    CustomerNotification[] {

    switch (
      this.selectedFilter
    ) {

      case 'unread':

        return this.notifications
          .filter(
            notification =>
              !notification.read
          );


      case 'orders':

        return this.notifications
          .filter(
            notification =>
              notification.type ===
              'order'
          );


      case 'all':

      default:

        return this.notifications;

    }

  }


  // =========================================
  // CHANGE FILTER
  // =========================================

  setFilter(
    filter:
      NotificationFilter
  ): void {

    this.selectedFilter =
      filter;

  }


  // =========================================
  // MARK SINGLE AS READ
  // =========================================

  markAsRead(
    notification:
      CustomerNotification
  ): void {

    notification.read =
      true;

  }


  // =========================================
  // MARK ALL AS READ
  // =========================================

  markAllAsRead():
    void {

    this.notifications =
      this.notifications.map(
        notification => ({

          ...notification,

          read:
            true

        })
      );

  }


  // =========================================
  // OPEN DELETE CONFIRMATION
  // =========================================

  openDeleteConfirmation(
    notification:
      CustomerNotification
  ): void {

    this.selectedDeleteNotification =
      notification;

    this.deleteConfirmPopup =
      true;

  }


  // =========================================
  // CLOSE DELETE CONFIRMATION
  // =========================================

  closeDeleteConfirmation():
    void {

    this.deleteConfirmPopup =
      false;

    this.selectedDeleteNotification =
      null;

  }


  // =========================================
  // CONFIRM DELETE
  // =========================================

  confirmDeleteNotification():
    void {

    if (
      !this.selectedDeleteNotification
    ) {

      return;

    }


    const notificationId =
      this.selectedDeleteNotification.id;


    this.notifications =
      this.notifications.filter(
        notification =>
          notification.id !==
          notificationId
      );


    this.closeDeleteConfirmation();

  }


  // =========================================
  // NOTIFICATION CLICK
  // =========================================

  openNotification(
    notification:
      CustomerNotification
  ): void {

    this.markAsRead(
      notification
    );


    // =====================================
    // ORDER
    // =====================================

    if (
      notification.action ===
      'order'
    ) {

      this.router.navigate([
        '/home-cust/order'
      ]);

      return;

    }


    // =====================================
    // COLLECTION
    // =====================================

    if (
      notification.action ===
      'collection'
    ) {

      this.router.navigate([
        '/home-cust/shopsilk'
      ]);

    }

  }

}