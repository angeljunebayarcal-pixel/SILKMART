
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { Firestore, doc, getDocFromServer } from '@angular/fire/firestore';
import { OrderServ } from '../../../services/order.serv';

interface CartItem {
  id: number;
  userId: string;
  productId?: string;
  name: string;
  category: string;
  description?: string;
  price: number;
  quantity: number;
  stock: number;
  imageUrl?: string;
  image?: string;
  colors?: string[];
  artClass: string;
  selected: boolean;
}

@Component({
  selector: 'app-add2cart',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add2cart.html',
  styleUrl: './add2cart.scss'
})
export class Add2cart implements OnInit, OnDestroy {
  currentUserId = '';
  authResolved = false;

  private stopAuthListener: (() => void) | null = null;

  cartItems: CartItem[] = [];

  showRemovePopup = false;
  selectedRemoveItem: CartItem | null = null;

  showCheckoutPopup = false;
  showSuccessPopup = false;

  errorMessage = '';
  checkoutSaving = false;
  lastOrderId = '';

  preferredDeliveryDate = '';
  minDeliveryDate = this.getEarliestDeliveryDate();

  constructor(
    private router: Router,
    private auth: Auth,
    private firestore: Firestore,
    private injector: Injector,
    private cdr: ChangeDetectorRef,
    private orderService: OrderServ
  ) {}

  ngOnInit(): void {
    this.stopAuthListener = runInInjectionContext(
      this.injector,
      () => onAuthStateChanged(
        this.auth,
        user => {
          this.authResolved = true;

          if (!user) {
            this.currentUserId = '';
            this.cartItems = [];
            this.closeRemovePopup();
            this.closeCheckoutPopup();
            this.cdr.detectChanges();
            return;
          }

          this.currentUserId = user.uid;
          this.loadCart();
          this.cdr.detectChanges();
        },
        error => {
          console.error('Authentication error:', error);
          this.authResolved = true;
          this.currentUserId = '';
          this.cartItems = [];
          this.errorMessage =
            'Unable to verify your account.';
          this.cdr.detectChanges();
        }
      )
    );
  }

  ngOnDestroy(): void {
    this.stopAuthListener?.();
    this.stopAuthListener = null;
  }

  // =========================================
  // IMAGE HELPERS
  // =========================================

  getItemImage(item: CartItem): string {
    return String(
      item.imageUrl ||
      item.image ||
      ''
    );
  }

  getStockUnit(item: CartItem): string {
    if (item.category === 'Silkworms') return 'worms';
    if (item.category === 'Cocoons') return 'cocoons';
    return 'pcs';
  }

  getColorText(item: CartItem): string {
    return Array.isArray(item.colors)
      ? item.colors.join(', ')
      : '';
  }

  // =========================================
  // LOCAL CART STORAGE
  // =========================================

  private getStoredCart(): CartItem[] {
    try {
      const stored = localStorage.getItem('silkCart');

      if (!stored) return [];

      const parsed = JSON.parse(stored);

      return Array.isArray(parsed) ? parsed : [];

    } catch (error) {
      console.error('Unable to read cart:', error);
      return [];
    }
  }

  loadCart(): void {
    if (!this.currentUserId) {
      this.cartItems = [];
      return;
    }

    this.cartItems = this.getStoredCart()
      .filter(
        item => item.userId === this.currentUserId
      )
      .map(item => ({
        ...item,
        imageUrl: String(
          item.imageUrl || item.image || ''
        ),
        colors: Array.isArray(item.colors)
          ? item.colors
          : [],
        selected: item.selected !== false
      }))
      .sort((a, b) => b.id - a.id);
  }

  saveCart(): void {
    if (!this.currentUserId) return;

    try {
      const otherCustomers = this.getStoredCart().filter(
        item => item.userId !== this.currentUserId
      );

      localStorage.setItem(
        'silkCart',
        JSON.stringify([
          ...otherCustomers,
          ...this.cartItems
        ])
      );

    } catch (error) {
      console.error('Unable to save cart:', error);
      this.errorMessage =
        'Unable to save shopping bag changes.';
    }
  }

  // =========================================
  // CART SUMMARY
  // =========================================

  get itemCount(): number {
    return this.cartItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
  }

  get selectedItems(): CartItem[] {
    return this.cartItems.filter(item => item.selected);
  }

  get selectedCount(): number {
    return this.selectedItems.length;
  }

  get allSelected(): boolean {
    return this.cartItems.length > 0 &&
      this.cartItems.every(item => item.selected);
  }

  get subtotal(): number {
    return this.selectedItems.reduce(
      (sum, item) =>
        sum + item.price * item.quantity,
      0
    );
  }

  get total(): number {
    return this.subtotal;
  }

  // =========================================
  // SELECT ITEMS
  // =========================================

  toggleItem(item: CartItem): void {
    if (this.checkoutSaving) return;

    item.selected = !item.selected;
    this.saveCart();
  }

  toggleAll(): void {
    if (this.checkoutSaving) return;

    const shouldSelect = !this.allSelected;

    this.cartItems.forEach(
      item => item.selected = shouldSelect
    );

    this.saveCart();
  }

  // =========================================
  // ITEM QUANTITY
  // =========================================

  increaseQuantity(item: CartItem): void {
    if (this.checkoutSaving) return;
    if (item.quantity >= item.stock) return;

    item.quantity++;
    this.saveCart();
  }

  decreaseQuantity(item: CartItem): void {
    if (this.checkoutSaving) return;
    if (item.quantity <= 1) return;

    item.quantity--;
    this.saveCart();
  }

  // =========================================
  // REMOVE ITEM
  // =========================================

  openRemovePopup(item: CartItem): void {
    if (this.checkoutSaving) return;

    this.selectedRemoveItem = item;
    this.showRemovePopup = true;
  }

  closeRemovePopup(): void {
    this.selectedRemoveItem = null;
    this.showRemovePopup = false;
  }

  confirmRemove(): void {
    if (
      !this.selectedRemoveItem ||
      this.checkoutSaving
    ) {
      return;
    }

    const id = this.selectedRemoveItem.id;

    this.cartItems = this.cartItems.filter(
      item => item.id !== id
    );

    this.saveCart();
    this.closeRemovePopup();
  }

  // =========================================
  // DELIVERY DATE
  // =========================================

  getEarliestDeliveryDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);

    const year = date.getFullYear();
    const month = String(
      date.getMonth() + 1
    ).padStart(2, '0');

    const day = String(
      date.getDate()
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  // =========================================
  // CHECKOUT POPUP
  // =========================================

  openCheckoutPopup(): void {
    if (this.checkoutSaving) return;

    this.errorMessage = '';

    if (!this.currentUserId) {
      this.errorMessage =
        'Please log in before placing an order.';
      return;
    }

    if (this.selectedCount === 0) {
      this.errorMessage =
        'Please select at least one product.';
      return;
    }

    const unavailable = this.selectedItems.find(
      item =>
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.stock < 1 ||
        item.quantity > item.stock
    );

    if (unavailable) {
      this.errorMessage =
        'Please check item quantities before checking out.';
      return;
    }

    this.preferredDeliveryDate = '';
    this.minDeliveryDate = this.getEarliestDeliveryDate();
    this.showCheckoutPopup = true;
  }

  closeCheckoutPopup(): void {
    if (this.checkoutSaving) return;

    this.showCheckoutPopup = false;
    this.errorMessage = '';
  }

  // =========================================
  // VERIFY LIVE FIRESTORE STOCK BEFORE CHECKOUT
  // =========================================

  private async verifySelectedStock(
    items: CartItem[]
  ): Promise<void> {
    const productIds = [...new Set(
      items.map(item => String(item.productId || '').trim())
    )];

    if (productIds.includes('')) {
      throw new Error(
        'An item in your bag is from an older listing. ' +
        'Remove it and add the product again from Shop Silk.'
      );
    }

    const latestProducts = new Map<string, any>();

    for (const productId of productIds) {
      const productRef = runInInjectionContext(
        this.injector,
        () => doc(this.firestore, 'products', productId)
      );

      let snapshot;
      try {
        snapshot = await runInInjectionContext(
          this.injector,
          () => getDocFromServer(productRef)
        );
      } catch (error: any) {
        if (error?.code === 'permission-denied') {
          throw new Error(
            'A product is no longer available for purchase. ' +
            'Please review your shopping bag.'
          );
        }
        throw error;
      }

      if (!snapshot.exists()) {
        throw new Error(
          'A product in your bag is no longer available. ' +
          'Please remove it before ordering.'
        );
      }

      const product = snapshot.data();
      if (product['published'] !== true ||
          !Number.isInteger(Number(product['stock'])) ||
          Number(product['stock']) <= 0) {
        throw new Error(
          `${String(product['name'] || 'A product')} is out of stock or unpublished.`
        );
      }
      latestProducts.set(productId, product);
    }

    const perProduct = new Map<string, number>();
    const perColor = new Map<string, number>();

    for (const item of items) {
      const productId = String(item.productId).trim();
      const product = latestProducts.get(productId);
      const colors = Array.isArray(product['colorStocks'])
        ? product['colorStocks']
        : [];
      const selectedColors = (item.colors || [])
        .map(color => String(color).trim())
        .filter(Boolean);

      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new Error(`Invalid quantity for ${item.name}.`);
      }

      if (Number(product['price']) !== Number(item.price)) {
        throw new Error(
          `The price of ${item.name} has changed. ` +
          'Remove it and add the updated product again.'
        );
      }

      if (colors.length > 0) {
        if (selectedColors.length !== 1) {
          throw new Error(
            `Please select one available color for ${item.name} in Shop Silk.`
          );
        }
        const color = colors.find(
          (entry: any) => entry?.name === selectedColors[0]
        );
        if (!color || !Number.isInteger(Number(color.quantity))) {
          throw new Error(
            `The selected color for ${item.name} is unavailable.`
          );
        }
        const key = `${productId}::${selectedColors[0]}`;
        const required = (perColor.get(key) || 0) + item.quantity;
        if (required > Number(color.quantity)) {
          throw new Error(
            `Only ${Number(color.quantity)} ${selectedColors[0]} ` +
            `${item.name} available. Please reduce your quantity.`
          );
        }
        perColor.set(key, required);
      } else if (selectedColors.length > 0) {
        throw new Error(
          `The color selection for ${item.name} has changed. ` +
          'Please add the product again.'
        );
      }

      const requiredTotal =
        (perProduct.get(productId) || 0) + item.quantity;
      if (requiredTotal > Number(product['stock'])) {
        throw new Error(
          `Only ${Number(product['stock'])} ${item.name} available. ` +
          'Please reduce your quantity.'
        );
      }
      perProduct.set(productId, requiredTotal);
    }
  }

  // =========================================
  // CONFIRM CHECKOUT
  // =========================================

  async confirmCheckout(): Promise<void> {
    if (this.checkoutSaving) return;

    this.errorMessage = '';

    if (
      !this.currentUserId ||
      this.selectedCount === 0
    ) {
      this.errorMessage =
        'Please select products before checkout.';
      return;
    }

    this.minDeliveryDate = this.getEarliestDeliveryDate();

    const selectedDate = this.preferredDeliveryDate;

    const validDateFormat =
      /^\d{4}-\d{2}-\d{2}$/.test(selectedDate);

    const parsedDate = validDateFormat
      ? new Date(`${selectedDate}T00:00:00`)
      : new Date(NaN);

    if (
      !validDateFormat ||
      selectedDate < this.minDeliveryDate ||
      Number.isNaN(parsedDate.getTime())
    ) {
      this.errorMessage =
        'Please select a valid preferred delivery date.';
      return;
    }

    const unavailable = this.selectedItems.find(
      item =>
        !item.name?.trim() ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > item.stock ||
        !Number.isFinite(Number(item.price)) ||
        Number(item.price) < 0
    );

    if (unavailable) {
      this.errorMessage =
        'Some selected items have invalid quantities or prices.';
      return;
    }

    const purchasedItems = this.selectedItems.map(
      item => ({
        ...item,
        colors: [...(item.colors || [])]
      })
    );

    const customerAtCheckout = this.currentUserId;

    this.checkoutSaving = true;
    this.cdr.detectChanges();

    try {
      // Recheck Firestore immediately before creating the order.
      // This is a preliminary check; the final order/stock update
      // must use an atomic transaction in OrderServ.
      await this.verifySelectedStock(purchasedItems);

      if (this.currentUserId !== customerAtCheckout) {
        throw new Error('Your account changed during checkout. Please retry.');
      }

      // Pass the original product image from the cart.
      // Do not save an empty image string.

      const firebaseOrderId =
        await this.orderService.createOrder({
          items: purchasedItems.map(item => ({
            productId: String(item.productId || ''),
            selectedColor: item.colors?.[0] || '',
            name: item.name,
            category: item.category,
            price: Number(item.price),
            quantity: Number(item.quantity),
            image: this.getItemImage(item),
            artClass: item.artClass
          })),

          preferredDeliveryDate: selectedDate,
          deliveryFee: 0,

          // Preserve optional colors in order notes.
          notes: purchasedItems
            .filter(
              item =>
                Array.isArray(item.colors) &&
                item.colors.length > 0
            )
            .map(
              item =>
                `${item.name}: preferred colors - ${item.colors!.join(', ')}`
            )
            .join('; ')
        });

      this.lastOrderId = firebaseOrderId;

      const purchasedIds = new Set(
        purchasedItems.map(item => item.id)
      );

      const remainingCart = this.getStoredCart().filter(
        item =>
          item.userId !== customerAtCheckout ||
          !purchasedIds.has(item.id)
      );

      try {
        localStorage.setItem(
          'silkCart',
          JSON.stringify(remainingCart)
        );
      } catch (storageError) {
        console.error(
          'Order saved, but cart cleanup failed:',
          storageError
        );
      }

      if (this.currentUserId === customerAtCheckout) {
        this.cartItems = this.cartItems.filter(
          item => !purchasedIds.has(item.id)
        );

        this.showCheckoutPopup = false;
        this.preferredDeliveryDate = '';
        this.showSuccessPopup = true;
      }

    } catch (error: any) {
      console.error('Firebase checkout failed:', error);

      if (error?.code === 'permission-denied') {
        this.errorMessage =
          'Firebase denied this order. Please check your account and Firestore permissions.';
      } else if (error?.code === 'unavailable') {
        this.errorMessage =
          'Firebase is unavailable. Please check your internet connection.';
      } else {
        this.errorMessage =
          error?.message ||
          'Unable to complete checkout. Please try again.';
      }

    } finally {
      this.checkoutSaving = false;
      this.cdr.detectChanges();
    }
  }

  closeSuccessPopup(): void {
    this.showSuccessPopup = false;
  }

  continueShopping(): void {
    this.router.navigate(['/home-cust/shopsilk']);
  }

  viewOrders(): void {
    this.showSuccessPopup = false;
    this.router.navigate(['/home-cust/order']);
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
