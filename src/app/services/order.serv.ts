
import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  getDoc,
  query,
  runTransaction,
  serverTimestamp,
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
  productId?: string;
  selectedColor?: string;
  sourceSpeciesId?: string;
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
  stockDeducted?: boolean;
  stockRestored?: boolean;
  inventoryVersion?: number;
}

export interface CreateOrderInput {
  items: OrderProduct[];
  preferredDeliveryDate: string;
  deliveryAddress?: string;
  phoneNumber?: string;
  notes?: string;
  deliveryFee?: number;
}

interface ProductColorStock {
  name: string;
  quantity: number;
  lowStockThreshold?: number;
}

interface ProductRecord {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  imageUrl: string;
  published: boolean;
  sourceSpeciesId?: string;
  colorStocks: ProductColorStock[];
}

interface StockChange {
  productId: string;
  selectedColor: string;
  quantity: number;
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

    const snapshot = await getDoc(profileReference);

    const profile: any = snapshot.exists()
      ? snapshot.data()
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
  // INVENTORY HELPERS
  // =========================================

  private toValidStock(
    value: unknown,
    label: string
  ): number {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      throw new Error(
        `Missing inventory quantity for ${label}.`
      );
    }

    const quantity = Number(value);

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0
    ) {
      throw new Error(
        `Invalid inventory quantity for ${label}.`
      );
    }

    return quantity;
  }

  private normalizeColors(
    value: unknown
  ): ProductColorStock[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((entry: any) => ({
      name: String(entry?.name || '').trim(),
      quantity: this.toValidStock(
        entry?.quantity,
        String(entry?.name || 'color')
      ),
      ...(entry?.lowStockThreshold != null
        ? {
            lowStockThreshold:
              Number(entry.lowStockThreshold)
          }
        : {})
    }));
  }

  private parseProduct(
    productId: string,
    data: any
  ): ProductRecord {
    return {
      id: productId,
      name: String(data.name || ''),
      category: String(data.category || ''),
      price: Number(data.price),
      stock: this.toValidStock(
        data.stock,
        data.name || productId
      ),
      imageUrl: String(data.imageUrl || ''),
      published: data.published === true,
      sourceSpeciesId: String(
        data.sourceSpeciesId || ''
      ),
      colorStocks: this.normalizeColors(
        data.colorStocks
      )
    };
  }

  private requiresColor(
    product: ProductRecord
  ): boolean {
    const category =
      product.category.trim().toLowerCase();

    return (
      category !== 'silkworms' &&
      category !== 'cocoons' &&
      product.colorStocks.length > 0
    );
  }

  private stockKey(
    productId: string,
    selectedColor: string
  ): string {
    return JSON.stringify([
      productId,
      selectedColor
    ]);
  }

  private aggregateChanges(
    items: OrderProduct[]
  ): StockChange[] {
    const changes = new Map<string, StockChange>();

    for (const item of items) {
      const productId =
        String(item.productId || '').trim();

      if (!productId) {
        throw new Error(
          `Product ID is missing for ${item.name}.`
        );
      }

      const selectedColor =
        String(item.selectedColor || '').trim();

      const quantity = Number(item.quantity);

      if (
        !Number.isSafeInteger(quantity) ||
        quantity < 1
      ) {
        throw new Error(
          `Invalid quantity for ${item.name}.`
        );
      }

      const key = this.stockKey(
        productId,
        selectedColor
      );

      const previous = changes.get(key);

      const total = (previous?.quantity || 0) + quantity;

      if (!Number.isSafeInteger(total)) {
        throw new Error(
          `Order quantity is too large for ${item.name}.`
        );
      }

      changes.set(key, {
        productId,
        selectedColor,
        quantity: total
      });
    }

    return [...changes.values()];
  }

  // =========================================
  // CREATE ORDER - DO NOT DEDUCT STOCK
  // =========================================

  async createOrder(
    input: CreateOrderInput
  ): Promise<string> {
    const user = this.getCurrentUser();

    if (
      !Array.isArray(input.items) ||
      input.items.length < 1 ||
      input.items.length > 30
    ) {
      throw new Error(
        'Please select between 1 and 30 products.'
      );
    }

    const preferredDate =
      String(input.preferredDeliveryDate || '');

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ||
      Number.isNaN(
        new Date(
          `${preferredDate}T00:00:00`
        ).getTime()
      )
    ) {
      throw new Error(
        'Please select a valid delivery date.'
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

    const requestedItems = input.items.map(item => ({
      ...item,
      productId: String(
        item.productId || ''
      ).trim(),
      selectedColor: String(
        item.selectedColor || ''
      ).trim(),
      quantity: Number(item.quantity)
    }));

    const changes =
      this.aggregateChanges(requestedItems);

    const productIds: string[] = [
      ...new Set(
        changes.map(item => item.productId)
      )
    ].sort();

    const orderReference = doc(
      this.ordersCollection
    );

    await runTransaction(
      this.firestore,
      async transaction => {

        // Read all required Firestore documents
        // before performing any transaction writes.

        const products = new Map<
          string,
          ProductRecord
        >();

        for (const productId of productIds) {
          const reference = doc(
            this.firestore,
            'products',
            productId
          );

          const snapshot =
            await transaction.get(reference);

          if (!snapshot.exists()) {
            throw new Error(
              'A selected product is no longer available.'
            );
          }

          const product = this.parseProduct(
            productId,
            snapshot.data()
          );

          if (!product.published) {
            throw new Error(
              `${product.name} is not available for ordering.`
            );
          }

          if (
            !Number.isFinite(product.price) ||
            product.price < 0
          ) {
            throw new Error(
              `Invalid price for ${product.name}.`
            );
          }

          products.set(productId, product);
        }

        // =====================================
        // VALIDATE SHARED SILKWORM INVENTORY
        // =====================================

        // Read the authoritative species stock.
        // No stock is reserved or deducted here.

        const productBySpecies =
          new Map<string, string>();

        const speciesStocks =
          new Map<string, number>();

        for (const product of products.values()) {
          const isSilkworm =
            product.category.trim().toLowerCase() ===
            'silkworms';

          const sourceId = String(
            product.sourceSpeciesId || ''
          ).trim();

          if (isSilkworm && !sourceId) {
            throw new Error(
              `${product.name} needs a verified species inventory link. ` +
              'Please contact SilkMart staff before ordering it.'
            );
          }

          if (!isSilkworm && sourceId) {
            throw new Error(
              `${product.name} has an invalid species inventory link.`
            );
          }

          if (isSilkworm) {
            const existingProduct =
              productBySpecies.get(sourceId);

            if (
              existingProduct &&
              existingProduct !== product.id
            ) {
              throw new Error(
                'Two selected products reference the same silkworm species. ' +
                'Please contact SilkMart staff to review the listings.'
              );
            }

            productBySpecies.set(
              sourceId,
              product.id
            );
          }
        }

        for (
          const [sourceId, productId]
          of productBySpecies
        ) {
          const speciesReference = doc(
            this.firestore,
            'inventory_species',
            sourceId
          );

          const speciesSnapshot =
            await transaction.get(speciesReference);

          if (!speciesSnapshot.exists()) {
            throw new Error(
              'An ordered silkworm species is no longer available.'
            );
          }

          const speciesQuantity = this.toValidStock(
            speciesSnapshot.data()?.['quantity'],
            sourceId
          );

          const product =
            products.get(productId)!;

          if (speciesQuantity !== product.stock) {
            throw new Error(
              `${product.name} has inconsistent inventory quantities. ` +
              'Please contact SilkMart staff to reconcile the stock ' +
              'before ordering.'
            );
          }

          speciesStocks.set(
            sourceId,
            speciesQuantity
          );
        }

        // All inventory reads are complete.
        // No stock writes occur at checkout.

        // =====================================
        // VALIDATE REQUESTED QUANTITIES
        // =====================================

        const requestedByProduct = new Map<
          string,
          number
        >();

        const updatedColors = new Map<
          string,
          ProductColorStock[]
        >();

        for (const product of products.values()) {
          updatedColors.set(
            product.id,
            product.colorStocks.map(
              color => ({ ...color })
            )
          );
        }

        for (const change of changes) {
          const product =
            products.get(change.productId)!;

          const previousTotal =
            requestedByProduct.get(
              change.productId
            ) || 0;

          const nextTotal =
            previousTotal + change.quantity;

          if (!Number.isSafeInteger(nextTotal)) {
            throw new Error(
              `Order quantity is too large for ${product.name}.`
            );
          }

          requestedByProduct.set(
            change.productId,
            nextTotal
          );

          if (this.requiresColor(product)) {
            if (!change.selectedColor) {
              throw new Error(
                `Select a color for ${product.name}.`
              );
            }

            const colors =
              updatedColors.get(product.id)!;

            const color = colors.find(
              item =>
                item.name === change.selectedColor
            );

            if (!color) {
              throw new Error(
                `Selected color is unavailable for ${product.name}.`
              );
            }

            if (color.quantity < change.quantity) {
              throw new Error(
                `Insufficient ${change.selectedColor} stock for ${product.name}.`
              );
            }

            color.quantity -= change.quantity;

          } else if (change.selectedColor) {
            throw new Error(
              `${product.name} does not require a color.`
            );
          }
        }

        for (const product of products.values()) {
          const requested =
            requestedByProduct.get(product.id) || 0;

          const available = product.sourceSpeciesId
            ? speciesStocks.get(product.sourceSpeciesId)
            : product.stock;

          if (available === undefined) {
            throw new Error(
              `Unable to verify shared stock for ${product.name}.`
            );
          }

          if (requested > available) {
            throw new Error(
              `Only ${available} units of ${product.name} are available.`
            );
          }
        }

        // =====================================
        // BUILD ORDER USING CURRENT PRODUCT DATA
        // =====================================

        const items: OrderProduct[] =
          requestedItems.map(item => {
            const product =
              products.get(item.productId)!;

            return {
              productId: product.id,
              ...(item.selectedColor
                ? {
                    selectedColor:
                      item.selectedColor
                  }
                : {}),
              ...(product.sourceSpeciesId
                ? {
                    sourceSpeciesId:
                      product.sourceSpeciesId
                  }
                : {}),
              name: product.name,
              category: product.category,
              price: product.price,
              quantity: item.quantity,
              image: product.imageUrl,
              artClass: String(
                item.artClass || ''
              )
            };
          });

        const subtotal = items.reduce(
          (sum, item) =>
            sum + item.price * item.quantity,
          0
        );

        // Inventory is NOT modified at checkout.
        // Stock remains available until successful delivery.

        const newOrder: SilkMartOrder = {
          id: orderReference.id,
          customerId: user.uid,
          customer,
          items,
          subtotal,
          deliveryFee,
          total: subtotal + deliveryFee,
          preferredDeliveryDate: preferredDate,
          paymentMethod: 'Cash on Delivery',
          notes: String(input.notes || '').trim(),
          status: 'Pending',
          cancelReason: '',
          stockDeducted: false,
          stockRestored: false,
          inventoryVersion: 2,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        transaction.set(
          orderReference,
          newOrder
        );
      }
    );

    return orderReference.id;
  }

  // =========================================
  // RESTORE RESERVED INVENTORY
  // =========================================


  private async restoreStockInTransaction(
    transaction: any,
    order: SilkMartOrder
  ): Promise<void> {
    if (
      order.stockDeducted !== true ||
      order.stockRestored === true
    ) {
      return;
    }

    const changes = this.aggregateChanges(
      order.items
    );

    const productTotals = new Map<
      string,
      number
    >();

    const productColors = new Map<
      string,
      Map<string, number>
    >();

    const speciesTotals = new Map<
      string,
      number
    >();

    for (const change of changes) {
      productTotals.set(
        change.productId,
        (productTotals.get(change.productId) || 0) +
          change.quantity
      );

      if (change.selectedColor) {
        if (!productColors.has(change.productId)) {
          productColors.set(
            change.productId,
            new Map<string, number>()
          );
        }

        const colors =
          productColors.get(change.productId)!;

        colors.set(
          change.selectedColor,
          (colors.get(change.selectedColor) || 0) +
            change.quantity
        );
      }
    }

    const productSnapshots = new Map<
      string,
      {
        reference: ReturnType<typeof doc>;
        product: ProductRecord;
      }
    >();

    // Read product records first.

    for (
      const productId of [...productTotals.keys()].sort()
    ) {
      const reference = doc(
        this.firestore,
        'products',
        productId
      );

      const snapshot =
        await transaction.get(reference);

      if (!snapshot.exists()) {
        throw new Error(
          'Cannot restore stock: an original product was deleted.'
        );
      }

      productSnapshots.set(productId, {
        reference,
        product: this.parseProduct(
          productId,
          snapshot.data()
        )
      });
    }

    for (const item of order.items) {
      const speciesId = String(
        item.sourceSpeciesId || ''
      );

      if (speciesId) {
        speciesTotals.set(
          speciesId,
          (speciesTotals.get(speciesId) || 0) +
            item.quantity
        );
      }
    }

    const speciesSnapshots = new Map<
      string,
      {
        reference: ReturnType<typeof doc>;
        quantity: number;
      }
    >();

    for (
      const speciesId of [...speciesTotals.keys()].sort()
    ) {
      const reference = doc(
        this.firestore,
        'inventory_species',
        speciesId
      );

      const snapshot =
        await transaction.get(reference);

      if (!snapshot.exists()) {
        throw new Error(
          'Cannot restore stock: linked silkworm inventory is missing.'
        );
      }

      speciesSnapshots.set(speciesId, {
        reference,
        quantity: this.toValidStock(
          snapshot.data()?.['quantity'],
          speciesId
        )
      });
    }

    // All transaction reads are complete.
    // Inventory writes begin here.

    for (
      const [productId, quantity]
      of productTotals
    ) {
      const entry =
        productSnapshots.get(productId)!;

      const fields: Record<string, unknown> = {
        stock: entry.product.stock + quantity,
        updatedAt: serverTimestamp()
      };

      const returnedColors =
        productColors.get(productId);

      if (returnedColors?.size) {
        const updated =
          entry.product.colorStocks.map(
            color => ({ ...color })
          );

        for (
          const [colorName, amount]
          of returnedColors
        ) {
          const color = updated.find(
            item => item.name === colorName
          );

          if (!color) {
            throw new Error(
              `Cannot restore removed color ${colorName}.`
            );
          }

          color.quantity += amount;
        }

        fields['colorStocks'] = updated;
      }

      transaction.update(
        entry.reference,
        fields
      );
    }

    for (
      const [speciesId, quantity]
      of speciesTotals
    ) {
      const entry =
        speciesSnapshots.get(speciesId)!;

      transaction.update(
        entry.reference,
        {
          quantity: entry.quantity + quantity,
          updatedAt: serverTimestamp(),
          updatedBy: this.getCurrentUser().uid
        }
      );
    }
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
      !['Confirmed', 'Rejected', 'Delivered']
        .includes(status)
    ) {
      throw new Error(
        'Invalid order status.'
      );
    }

    // Only Delivery Management may mark an order Delivered.
    // A status-only update would bypass the stock transaction.
    if (status === 'Delivered') {
      throw new Error(
        'Complete this order through Delivery Management so stock is deducted exactly once.'
      );
    }

    const orderReference = doc(
      this.firestore,
      'orders',
      orderId
    );

    await runTransaction(
      this.firestore,
      async transaction => {
        const snapshot =
          await transaction.get(orderReference);

        if (!snapshot.exists()) {
          throw new Error('Order not found.');
        }

        const order =
          snapshot.data() as SilkMartOrder;

        if (
          status === 'Confirmed' &&
          order.status !== 'Pending'
        ) {
          throw new Error(
            'Only pending orders can be confirmed.'
          );
        }

        if (
          status === 'Rejected' &&
          order.status !== 'Pending'
        ) {
          throw new Error(
            'Only pending orders can be rejected.'
          );
        }

        if (status === 'Rejected') {
          await this.restoreStockInTransaction(
            transaction,
            order
          );

          transaction.update(
            orderReference,
            {
              status: 'Rejected',
              stockRestored:
                order.stockDeducted === true,
              updatedAt: serverTimestamp()
            }
          );

          return;
        }

        // Confirmation does not deduct or reserve inventory.
        transaction.update(orderReference, {
          status: 'Confirmed',
          updatedAt: serverTimestamp()
        });
      }
    );
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

    await runTransaction(
      this.firestore,
      async transaction => {
        const snapshot =
          await transaction.get(orderReference);

        if (!snapshot.exists()) {
          throw new Error('Order not found.');
        }

        const order =
          snapshot.data() as SilkMartOrder;

        if (order.customerId !== user.uid) {
          throw new Error(
            'You cannot cancel another customer’s order.'
          );
        }

        if (order.status !== 'Pending') {
          throw new Error(
            'Only pending orders can be cancelled.'
          );
        }

        await this.restoreStockInTransaction(
          transaction,
          order
        );

        transaction.update(
          orderReference,
          {
            status: 'Cancelled',
            cancelReason: trimmedReason,
            stockRestored:
              order.stockDeducted === true,
            updatedAt: serverTimestamp()
          }
        );
      }
    );
  }

  // =========================================
  // DELETE OWN CANCELLED ORDER
  // =========================================

  async deleteMyCancelledOrder(
    orderId: string
  ): Promise<void> {
    const user = this.getCurrentUser();

    if (!orderId) {
      throw new Error('Invalid order ID.');
    }

    const orderReference = doc(
      this.firestore,
      'orders',
      orderId
    );

    // Re-check ownership, status and stock restoration within
    // the same atomic transaction that deletes the order.
    await runTransaction(
      this.firestore,
      async transaction => {
        const snapshot = await transaction.get(orderReference);

        if (!snapshot.exists()) {
          throw new Error('Order not found. It may already be deleted.');
        }

        const order = snapshot.data() as SilkMartOrder;

        if (order.customerId !== user.uid) {
          throw new Error('You cannot delete another customer’s order.');
        }

        if (order.status !== 'Cancelled') {
          throw new Error('Only cancelled orders can be deleted permanently.');
        }

        if (
          order.stockDeducted === true &&
          order.stockRestored !== true
        ) {
          throw new Error(
            'Inventory must be restored before deletion.'
          );
        }

        transaction.delete(orderReference);
      }
    );
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
