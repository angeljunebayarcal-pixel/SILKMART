
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthServ } from '../../../services/auth.serv';
import { UserServ } from '../../../services/user.serv';
import { OrderServ } from '../../../services/order.serv';

interface Product {
  name: string;
  category: string;
  price: number;
  stock: number;
  featured: boolean;
  artClass: string;
}

type PendingAction =
  | 'quick-add'
  | 'add-bag'
  | 'order-now'
  | null;

@Component({
  selector: 'app-shopsilk',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './shopsilk.html',
  styleUrl: './shopsilk.scss',
})
export class Shopsilk {

  // =========================================
  // SEARCH / FILTER / SORT
  // =========================================

  searchTerm = '';
  selectedCategory = 'All pieces';
  sortOption = 'featured';

  // =========================================
  // PRODUCT POPUP
  // =========================================

  selectedProduct: Product | null = null;
  selectedQuantity = 1;

  // =========================================
  // ADD TO BAG CONFIRMATION
  // =========================================

  showAddBagConfirmation = false;
  confirmationProduct: Product | null = null;
  confirmationQuantity = 1;

  // =========================================
  // ORDER NOW CONFIRMATION
  // =========================================

  showOrderConfirmation = false;
  confirmationOrderProduct: Product | null = null;
  confirmationOrderQuantity = 1;

  preferredDeliveryDate = '';
  minDeliveryDate = this.getEarliestDeliveryDate();

  // Prevent duplicate Firebase purchases.
  orderSaving = false;

  // =========================================
  // ADD SUCCESS POPUP
  // =========================================

  addSuccessPopup = false;
  addedProduct: Product | null = null;

  // =========================================
  // REGISTER
  // =========================================

  showRegisterPopup = false;

  fullName = '';
  registerEmail = '';
  mobileNumber = '';
  completeAddress = '';
  registerPassword = '';
  confirmPassword = '';

  showRegisterPassword = false;
  showConfirmPassword = false;

  registerError = '';
  registerLoading = false;

  // =========================================
  // PENDING ACTION
  // =========================================

  pendingProduct: Product | null = null;
  pendingQuantity = 1;
  pendingAction: PendingAction = null;

  constructor(
    private router: Router,
    private authService: AuthServ,
    private userService: UserServ,
    private orderService: OrderServ
  ) {}

  // =========================================
  // PRODUCTS
  // =========================================

  products: Product[] = [
    {
      name: 'Luzon Mist Silk Scarf',
      category: 'SCARVES',
      price: 1450,
      stock: 24,
      featured: true,
      artClass: 'scarf-art'
    },
    {
      name: 'Mulberry Grove Silk Sleep Set',
      category: 'HOME & SLEEP',
      price: 3200,
      stock: 11,
      featured: true,
      artClass: 'sleep-art'
    },
    {
      name: 'Cocoon White Silk Ribbon',
      category: 'RIBBONS & TRIM',
      price: 680,
      stock: 38,
      featured: false,
      artClass: 'ribbon-art'
    },
    {
      name: 'Imelda Heritage Silk Throw',
      category: 'HOME & SLEEP',
      price: 4850,
      stock: 7,
      featured: false,
      artClass: 'throw-art'
    }
  ];

  // =========================================
  // FILTERED PRODUCTS
  // =========================================

  get filteredProducts(): Product[] {
    let result = [...this.products];

    if (this.selectedCategory !== 'All pieces') {
      const categoryMap: { [key: string]: string } = {
        'Scarves': 'SCARVES',
        'Home & sleep': 'HOME & SLEEP',
        'Ribbons & trim': 'RIBBONS & TRIM'
      };

      result = result.filter(
        product =>
          product.category === categoryMap[this.selectedCategory]
      );
    }

    if (this.searchTerm.trim()) {
      const search = this.searchTerm.toLowerCase().trim();

      result = result.filter(
        product =>
          product.name.toLowerCase().includes(search) ||
          product.category.toLowerCase().includes(search)
      );
    }

    switch (this.sortOption) {
      case 'low':
        result.sort((a, b) => a.price - b.price);
        break;

      case 'high':
        result.sort((a, b) => b.price - a.price);
        break;

      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;

      case 'featured':
      default:
        result.sort(
          (a, b) =>
            Number(b.featured) - Number(a.featured)
        );
        break;
    }

    return result;
  }

  // =========================================
  // CATEGORY
  // =========================================

  selectCategory(category: string): void {
    this.selectedCategory = category;
  }

  // =========================================
  // PRODUCT DETAILS
  // =========================================

  openProduct(product: Product): void {
    this.selectedProduct = product;
    this.selectedQuantity = 1;
  }

  closeProduct(): void {
    this.selectedProduct = null;
    this.selectedQuantity = 1;
  }

  increaseQuantity(): void {
    if (!this.selectedProduct) return;

    if (this.selectedQuantity < this.selectedProduct.stock) {
      this.selectedQuantity++;
    }
  }

  decreaseQuantity(): void {
    if (this.selectedQuantity > 1) {
      this.selectedQuantity--;
    }
  }

  // =========================================
  // REGISTER POPUP
  // =========================================

  openRegisterPopup(
    product: Product,
    quantity: number,
    action: Exclude<PendingAction, null>
  ): void {
    this.pendingProduct = product;
    this.pendingQuantity = quantity;
    this.pendingAction = action;

    this.showRegisterPopup = true;
    this.registerError = '';
    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  closeRegisterPopup(): void {
    if (this.registerLoading) return;

    this.showRegisterPopup = false;
    this.registerError = '';

    this.showRegisterPassword = false;
    this.showConfirmPassword = false;

    this.pendingProduct = null;
    this.pendingQuantity = 1;
    this.pendingAction = null;
  }

  toggleRegisterPassword(): void {
    this.showRegisterPassword = !this.showRegisterPassword;
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // =========================================
  // CREATE CUSTOMER ACCOUNT
  // =========================================

  async createAccount(): Promise<void> {
    if (this.registerLoading) return;

    this.registerError = '';

    if (
      !this.fullName.trim() ||
      !this.registerEmail.trim() ||
      !this.mobileNumber.trim() ||
      !this.completeAddress.trim() ||
      !this.registerPassword ||
      !this.confirmPassword
    ) {
      this.registerError = 'Please complete all fields.';
      return;
    }

    if (this.registerPassword !== this.confirmPassword) {
      this.registerError = 'Passwords do not match.';
      return;
    }

    if (this.registerPassword.length < 6) {
      this.registerError =
        'Password must contain at least 6 characters.';
      return;
    }

    try {
      this.registerLoading = true;

      const result = await this.authService.register(
        this.registerEmail.trim(),
        this.registerPassword
      );

      await this.userService.createUserProfile(
        result.user.uid,
        {
          fullName: this.fullName.trim(),
          email: this.registerEmail.trim().toLowerCase(),
          mobileNumber: this.mobileNumber.trim(),
          completeAddress: this.completeAddress.trim(),
          role: 'customer'
        }
      );

      sessionStorage.removeItem('silkmartGuestMode');

      this.showRegisterPopup = false;
      this.continuePendingOrder();
      this.clearRegisterForm();

    } catch (error: any) {
      console.error('Registration error:', error);

      switch (error?.code) {
        case 'auth/email-already-in-use':
          this.registerError =
            'This email address is already registered.';
          break;

        case 'auth/invalid-email':
          this.registerError =
            'Please enter a valid email address.';
          break;

        case 'auth/weak-password':
          this.registerError =
            'Please use a stronger password.';
          break;

        case 'auth/network-request-failed':
          this.registerError =
            'Network error. Please check your internet connection.';
          break;

        case 'permission-denied':
          this.registerError =
            'Firebase denied access to save your profile.';
          break;

        default:
          this.registerError =
            'Unable to create your account. Please try again.';
      }
    } finally {
      this.registerLoading = false;
    }
  }

  // =========================================
  // CLEAR REGISTER FORM
  // =========================================

  clearRegisterForm(): void {
    this.fullName = '';
    this.registerEmail = '';
    this.mobileNumber = '';
    this.completeAddress = '';
    this.registerPassword = '';
    this.confirmPassword = '';

    this.showRegisterPassword = false;
    this.showConfirmPassword = false;
  }

  // =========================================
  // CONTINUE PENDING ACTION
  // =========================================

  continuePendingOrder(): void {
    if (!this.pendingProduct || !this.pendingAction) {
      return;
    }

    const product = this.pendingProduct;
    const quantity = this.pendingQuantity;
    const action = this.pendingAction;

    if (action === 'quick-add' || action === 'order-now') {
      this.openOrderConfirmation(product, quantity);
    }

    if (action === 'add-bag') {
      this.confirmationProduct = product;
      this.confirmationQuantity = quantity;
      this.showAddBagConfirmation = true;
    }

    this.pendingProduct = null;
    this.pendingQuantity = 1;
    this.pendingAction = null;
  }

  // =========================================
  // PRODUCT CARD QUICK BUTTON
  // =========================================

  addToCart(product: Product): void {
    const user = this.authService.currentUser;

    if (!user) {
      this.openRegisterPopup(product, 1, 'quick-add');
      return;
    }

    // Preserve original behavior:
    // This quick button opens Order Now.
    this.openOrderConfirmation(product, 1);
  }

  // =========================================
  // ADD SUCCESS POPUP
  // =========================================

  closeAddSuccessPopup(): void {
    this.addSuccessPopup = false;
    this.addedProduct = null;
  }

  viewOrders(): void {
    this.closeAddSuccessPopup();
    this.router.navigate(['/home-cust/order']);
  }

  // =========================================
  // ADD TO BAG
  // =========================================

  addSelectedProduct(): void {
    if (!this.selectedProduct) return;

    const user = this.authService.currentUser;

    if (!user) {
      this.openRegisterPopup(
        this.selectedProduct,
        this.selectedQuantity,
        'add-bag'
      );
      return;
    }

    this.confirmationProduct = this.selectedProduct;
    this.confirmationQuantity = this.selectedQuantity;
    this.showAddBagConfirmation = true;
  }

  closeAddBagConfirmation(): void {
    this.showAddBagConfirmation = false;
    this.confirmationProduct = null;
    this.confirmationQuantity = 1;
  }

  // =========================================
  // SAVE TO CART (NOT A PURCHASE)
  // =========================================

  saveProductToBag(
    product: Product,
    quantity: number
  ): boolean {
    const user = this.authService.currentUser;

    if (!user) return false;

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > product.stock
    ) {
      return false;
    }

    try {
      const stored = localStorage.getItem('silkCart');
      let cart: any[] = [];

      if (stored) {
        const parsed = JSON.parse(stored);
        cart = Array.isArray(parsed) ? parsed : [];
      }

      const existingItem = cart.find(
        item =>
          item.userId === user.uid &&
          item.name === product.name
      );

      if (existingItem) {
        const updatedQuantity =
          Number(existingItem.quantity) + quantity;

        if (
          !Number.isFinite(updatedQuantity) ||
          updatedQuantity > product.stock
        ) {
          return false;
        }

        existingItem.quantity = updatedQuantity;
        existingItem.stock = product.stock;

      } else {
        cart.push({
          id: Date.now(),
          userId: user.uid,
          name: product.name,
          category: product.category,
          price: product.price,
          quantity,
          stock: product.stock,
          artClass: product.artClass,
          selected: true
        });
      }

      localStorage.setItem(
        'silkCart',
        JSON.stringify(cart)
      );

      return true;

    } catch (error) {
      console.error('Unable to save cart:', error);
      return false;
    }
  }

  confirmAddToBag(): void {
    if (!this.confirmationProduct) return;

    const saved = this.saveProductToBag(
      this.confirmationProduct,
      this.confirmationQuantity
    );

    if (!saved) {
      alert(
        'Unable to add the selected quantity. Please check available stock.'
      );
      return;
    }

    this.closeAddBagConfirmation();
    this.closeProduct();

    this.router.navigate(['/home-cust/add2cart']);
  }

  // =========================================
  // ORDER NOW
  // =========================================

  orderSelectedProduct(): void {
    if (!this.selectedProduct) return;

    const user = this.authService.currentUser;

    if (!user) {
      this.openRegisterPopup(
        this.selectedProduct,
        this.selectedQuantity,
        'order-now'
      );
      return;
    }

    this.openOrderConfirmation(
      this.selectedProduct,
      this.selectedQuantity
    );
  }

  // =========================================
  // OPEN ORDER CONFIRMATION
  // =========================================

  openOrderConfirmation(
    product: Product,
    quantity: number
  ): void {
    if (this.orderSaving) return;

    this.confirmationOrderProduct = product;
    this.confirmationOrderQuantity = quantity;
    this.preferredDeliveryDate = '';
    this.minDeliveryDate = this.getEarliestDeliveryDate();
    this.showOrderConfirmation = true;
  }

  // =========================================
  // CLOSE ORDER CONFIRMATION
  // =========================================

  closeOrderConfirmation(): void {
    if (this.orderSaving) return;

    this.showOrderConfirmation = false;
    this.confirmationOrderProduct = null;
    this.confirmationOrderQuantity = 1;
    this.preferredDeliveryDate = '';
  }

  // =========================================
  // MINIMUM DELIVERY DATE
  // =========================================

  getEarliestDeliveryDate(): string {
    const date = new Date();

    date.setDate(date.getDate() + 1);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  // =========================================
  // CONFIRM ORDER NOW -> FIREBASE
  // =========================================

  async confirmOrderNow(): Promise<void> {
    if (this.orderSaving || !this.confirmationOrderProduct) {
      return;
    }

    this.minDeliveryDate = this.getEarliestDeliveryDate();

    if (
      !this.preferredDeliveryDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(this.preferredDeliveryDate) ||
      this.preferredDeliveryDate < this.minDeliveryDate
    ) {
      alert('Please select a valid future delivery date.');
      return;
    }

    const product = this.confirmationOrderProduct;
    const quantity = this.confirmationOrderQuantity;
    const date = this.preferredDeliveryDate;

    this.orderSaving = true;

    try {
      await this.saveOrder(product, quantity, date);

      // Close only after Firestore confirms the save.
      this.showOrderConfirmation = false;
      this.confirmationOrderProduct = null;
      this.confirmationOrderQuantity = 1;
      this.preferredDeliveryDate = '';

      this.closeProduct();

      // Customer Orders will be connected to
      // Firebase in the next step.
      await this.router.navigate(['/home-cust/order']);

    } catch (error: any) {
      console.error('Firebase order error:', error);

      let message =
        error?.message ||
        'Unable to place your order. Please try again.';

      if (error?.code === 'permission-denied') {
        message =
          'Firebase denied the order. Check your Firestore rules and customer login.';
      }

      if (error?.code === 'unavailable') {
        message =
          'Firebase is currently unavailable. Please check your connection.';
      }

      alert(message);

    } finally {
      this.orderSaving = false;
    }
  }

  // =========================================
  // SAVE PURCHASE TO FIRESTORE
  // =========================================

  async saveOrder(
    product: Product,
    quantity: number,
    preferredDeliveryDate: string
  ): Promise<string> {

    const currentUser = this.authService.currentUser;

    if (!currentUser) {
      throw new Error('Please sign in before placing an order.');
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > product.stock
    ) {
      throw new Error(
        'Invalid quantity or insufficient available stock.'
      );
    }

    // This uses the shared Firestore OrderServ.
    // OrderServ obtains the customer's name,
    // email, phone, and address from their
    // Firebase users/{uid} profile.
    return await this.orderService.createOrder({
      items: [
        {
          name: product.name,
          category: product.category,
          price: product.price,
          quantity,
          image: '',
          artClass: product.artClass
        }
      ],
      preferredDeliveryDate,
      deliveryFee: 0,
      notes: ''
    });
  }

  // =========================================
  // FIND YOUR PIECE
  // =========================================

  scrollToCollection(): void {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  // =========================================
  // TRACK ORDER
  // =========================================

  trackOrder(): void {
    this.router.navigate(['/home-cust/order']);
  }
}
