
import { Injectable, inject } from '@angular/core';

import { Auth } from '@angular/fire/auth';

import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDoc,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from '@angular/fire/firestore';

import { Observable, map } from 'rxjs';

export type OrderStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Rejected'
  | 'Cancelled'
  | 'Delivered';

export interface OrderProduct {
  name: string;
  category: string;
  price: number;
  quantity: number;
  image: string;
  artClass: string;
}

export interface OrderCustomer {
  uid: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface SilkMartOrder {
  id: string;
  customerId: string;
  customer: OrderCustomer;
  items: OrderProduct[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  preferredDeliveryDate: string;
  paymentMethod: string;
  notes: string;
  status: OrderStatus;
  cancelReason: string;
  createdAt: any;
  updatedAt: any;
}

export interface CreateOrderInput {
  items: OrderProduct[];
  preferredDeliveryDate: string;
  deliveryAddress?: string;
  phoneNumber?: string;
  notes?: string;
  deliveryFee?: number;
}

@Injectable({
  providedIn: 'root'
})
export class OrderServ {

  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private readonly ordersCollection =
    collection(this.firestore, 'orders');

  // =========================================
  // CURRENT USER
  // =========================================

  private getCurrentUser() {
    const user = this.auth.currentUser;

    if (!user) {
      throw new Error(
        'Please log in to continue.'
      );
    }

    return user;
  }

  // =========================================
  // CUSTOMER PROFILE
  // =========================================

  private async getCustomerProfile(): Promise<OrderCustomer> {
    const user = this.getCurrentUser();

    const profileReference = doc(
      this.firestore,
      'users',
      user.uid
    );

    const profileSnapshot = await getDoc(
      profileReference
    );

    const profile: any = profileSnapshot.exists()
      ? profileSnapshot.data()
      : {};

    const firstAndLast = [
      profile.firstName,
      profile.lastName
    ].filter(Boolean).join(' ');

    const name = String(
      profile.fullName ||
      profile.name ||
      firstAndLast ||
      user.displayName ||
      'Customer'
    ).trim();

    return {
      uid: user.uid,
      name,
      email: String(
        profile.email || user.email || ''
      ),
      phone: String(
        profile.mobileNumber ||
        profile.phoneNumber ||
        profile.phone ||
        ''
      ),
      address: String(
        profile.completeAddress ||
        profile.deliveryAddress ||
        profile.address ||
        ''
      )
    };
  }

  // =========================================
  // CREATE ORDER
  // =========================================

  async createOrder(
    input: CreateOrderInput
  ): Promise<string> {
    const user = this.getCurrentUser();

    if (!input.items?.length) {
      throw new Error(
        'Please select at least one product.'
      );
    }

    if (!input.preferredDeliveryDate) {
      throw new Error(
        'Please select a preferred delivery date.'
      );
    }

    const date = new Date(
      input.preferredDeliveryDate
    );

    if (Number.isNaN(date.getTime())) {
      throw new Error(
        'Invalid delivery date.'
      );
    }

    const customer = await this.getCustomerProfile();

    customer.address = (
      input.deliveryAddress ??
      customer.address
    ).trim();

    customer.phone = (
      input.phoneNumber ??
      customer.phone
    ).trim();

    if (!customer.address) {
      throw new Error(
        'Please provide your delivery address.'
      );
    }

    if (!customer.phone) {
      throw new Error(
        'Please provide your contact number.'
      );
    }

    const items: OrderProduct[] = input.items.map(item => {
      const price = Number(item.price);
      const quantity = Number(item.quantity);

      if (
        !item.name?.trim() ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isInteger(quantity) ||
        quantity < 1
      ) {
        throw new Error(
          'Invalid product information.'
        );
      }

      return {
        name: item.name.trim(),
        category: item.category ?? '',
        price,
        quantity,
        image: item.image ?? '',
        artClass: item.artClass ?? ''
      };
    });

    const subtotal = items.reduce(
      (sum, item) =>
        sum + item.price * item.quantity,
      0
    );

    const deliveryFee = Number(
      input.deliveryFee ?? 0
    );

    if (
      !Number.isFinite(deliveryFee) ||
      deliveryFee < 0
    ) {
      throw new Error(
        'Invalid delivery fee.'
      );
    }

    const orderReference = doc(
      this.ordersCollection
    );

    const newOrder: SilkMartOrder = {
      id: orderReference.id,
      customerId: user.uid,
      customer,
      items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      preferredDeliveryDate:
        input.preferredDeliveryDate,
      paymentMethod: 'Cash on Delivery',
      notes: input.notes?.trim() ?? '',
      status: 'Pending',
      cancelReason: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(orderReference, newOrder);

    return orderReference.id;
  }

  // =========================================
  // CUSTOMER ORDERS
  // =========================================

  getMyOrders(): Observable<SilkMartOrder[]> {
    const user = this.getCurrentUser();

    const ordersQuery = query(
      this.ordersCollection,
      where('customerId', '==', user.uid)
    );

    return collectionData(
      ordersQuery,
      { idField: 'id' }
    ).pipe(
      map(data =>
        this.sortOrders(data as SilkMartOrder[])
      )
    );
  }

  // =========================================
  // ADMIN / STAFF ORDERS
  // =========================================

  getAllOrders(): Observable<SilkMartOrder[]> {
    return collectionData(
      this.ordersCollection,
      { idField: 'id' }
    ).pipe(
      map(data =>
        this.sortOrders(data as SilkMartOrder[])
      )
    );
  }

  // =========================================
  // ADMIN / STAFF STATUS UPDATE
  // =========================================

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus
  ): Promise<void> {
    this.getCurrentUser();

    if (
      !orderId ||
      !['Confirmed', 'Rejected', 'Delivered'].includes(status)
    ) {
      throw new Error(
        'Invalid order status.'
      );
    }

    const orderReference = doc(
      this.firestore,
      'orders',
      orderId
    );

    const snapshot = await getDoc(
      orderReference
    );

    if (!snapshot.exists()) {
      throw new Error('Order not found.');
    }

    const currentStatus = snapshot.data()['status'];

    if (
      status === 'Confirmed' &&
      currentStatus !== 'Pending'
    ) {
      throw new Error(
        'Only pending orders can be confirmed.'
      );
    }

    if (
      status === 'Rejected' &&
      currentStatus !== 'Pending'
    ) {
      throw new Error(
        'Only pending orders can be rejected.'
      );
    }

    if (
      status === 'Delivered' &&
      currentStatus !== 'Confirmed'
    ) {
      throw new Error(
        'Only confirmed orders can be delivered.'
      );
    }

    await updateDoc(orderReference, {
      status,
      updatedAt: serverTimestamp()
    });
  }

  // =========================================
  // CANCEL OWN PENDING ORDER
  // =========================================

  async cancelMyOrder(
    orderId: string,
    reason: string
  ): Promise<void> {
    const user = this.getCurrentUser();

    const trimmedReason = reason.trim();

    if (
      !trimmedReason ||
      trimmedReason.length > 500
    ) {
      throw new Error(
        'Please provide a valid cancellation reason.'
      );
    }

    const orderReference = doc(
      this.firestore,
      'orders',
      orderId
    );

    const snapshot = await getDoc(
      orderReference
    );

    if (!snapshot.exists()) {
      throw new Error('Order not found.');
    }

    const order = snapshot.data();

    if (order['customerId'] !== user.uid) {
      throw new Error(
        'You cannot cancel another customer’s order.'
      );
    }

    if (order['status'] !== 'Pending') {
      throw new Error(
        'Only pending orders can be cancelled.'
      );
    }

    await updateDoc(orderReference, {
      status: 'Cancelled',
      cancelReason: trimmedReason,
      updatedAt: serverTimestamp()
    });
  }

  // =========================================
  // DELETE OWN CANCELLED ORDER PERMANENTLY
  // =========================================

  async deleteMyCancelledOrder(
    orderId: string
  ): Promise<void> {
    const user = this.getCurrentUser();

    if (!orderId) {
      throw new Error(
        'Invalid order ID.'
      );
    }

    const orderReference = doc(
      this.firestore,
      'orders',
      orderId
    );

    const snapshot = await getDoc(
      orderReference
    );

    if (!snapshot.exists()) {
      throw new Error(
        'Order not found. It may already be deleted.'
      );
    }

    const order = snapshot.data();

    // Check ownership.
    if (order['customerId'] !== user.uid) {
      throw new Error(
        'You cannot delete another customer’s order.'
      );
    }

    // Only cancelled orders can be deleted.
    if (order['status'] !== 'Cancelled') {
      throw new Error(
        'Only cancelled orders can be deleted permanently.'
      );
    }

    // The Firestore security rules check these
    // conditions again on the server.

    await deleteDoc(orderReference);
  }

  // =========================================
  // SORT NEWEST FIRST
  // =========================================

  private sortOrders(
    orders: SilkMartOrder[]
  ): SilkMartOrder[] {
    return [...orders].sort((a, b) => {
      const dateA =
        a.createdAt?.toMillis?.() ?? 0;

      const dateB =
        b.createdAt?.toMillis?.() ?? 0;

      return dateB - dateA;
    });
  }
}
