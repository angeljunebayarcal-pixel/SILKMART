import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthServ } from '../../../services/auth.serv';
import { UserServ } from '../../../services/user.serv';


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

  imports: [
    CommonModule,
    FormsModule
  ],

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
  // ADD TO ORDERS POPUP
  // =========================================

  addSuccessPopup = false;

  addedProduct: Product | null = null;


  // =========================================
  // CREATE ACCOUNT POPUP
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
  // PENDING ORDER
  // =========================================

  pendingProduct: Product | null = null;

  pendingQuantity = 1;

  pendingAction: PendingAction = null;


  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private router: Router,
    private authService: AuthServ,
    private userService: UserServ
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

      const categoryMap: {
        [key: string]: string;
      } = {

        'Scarves': 'SCARVES',

        'Home & sleep': 'HOME & SLEEP',

        'Ribbons & trim': 'RIBBONS & TRIM'

      };


      result = result.filter(
        product =>
          product.category ===
          categoryMap[this.selectedCategory]
      );

    }


    if (this.searchTerm.trim()) {

      const search =
        this.searchTerm
          .toLowerCase()
          .trim();


      result = result.filter(product =>

        product.name
          .toLowerCase()
          .includes(search)

        ||

        product.category
          .toLowerCase()
          .includes(search)

      );

    }


    switch (this.sortOption) {

      case 'low':

        result.sort(
          (a, b) =>
            a.price - b.price
        );

        break;


      case 'high':

        result.sort(
          (a, b) =>
            b.price - a.price
        );

        break;


      case 'name':

        result.sort(
          (a, b) =>
            a.name.localeCompare(b.name)
        );

        break;


      case 'featured':

      default:

        result.sort(
          (a, b) =>
            Number(b.featured) -
            Number(a.featured)
        );

        break;

    }


    return result;

  }


  // =========================================
  // CATEGORY BUTTON
  // =========================================

  selectCategory(category: string): void {

    this.selectedCategory = category;

  }


  // =========================================
  // OPEN PRODUCT POPUP
  // =========================================

  openProduct(product: Product): void {

    this.selectedProduct = product;

    this.selectedQuantity = 1;

  }


  // =========================================
  // CLOSE PRODUCT POPUP
  // =========================================

  closeProduct(): void {

    this.selectedProduct = null;

    this.selectedQuantity = 1;

  }


  // =========================================
  // INCREASE QUANTITY
  // =========================================

  increaseQuantity(): void {

    if (!this.selectedProduct) {

      return;

    }


    if (
      this.selectedQuantity <
      this.selectedProduct.stock
    ) {

      this.selectedQuantity++;

    }

  }


  // =========================================
  // DECREASE QUANTITY
  // =========================================

  decreaseQuantity(): void {

    if (this.selectedQuantity > 1) {

      this.selectedQuantity--;

    }

  }


  // =========================================
  // OPEN REGISTER POPUP
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


  // =========================================
  // CLOSE REGISTER POPUP
  // =========================================

  closeRegisterPopup(): void {

    this.showRegisterPopup = false;

    this.registerError = '';

    this.showRegisterPassword = false;

    this.showConfirmPassword = false;

    this.pendingProduct = null;

    this.pendingQuantity = 1;

    this.pendingAction = null;

  }


  // =========================================
  // TOGGLE REGISTER PASSWORD
  // =========================================

  toggleRegisterPassword(): void {

    this.showRegisterPassword =
      !this.showRegisterPassword;

  }


  // =========================================
  // TOGGLE CONFIRM PASSWORD
  // =========================================

  toggleConfirmPassword(): void {

    this.showConfirmPassword =
      !this.showConfirmPassword;

  }


  // =========================================
  // CREATE CUSTOMER ACCOUNT
  // =========================================

  async createAccount(): Promise<void> {

    this.registerError = '';


    if (
      !this.fullName.trim() ||
      !this.registerEmail.trim() ||
      !this.mobileNumber.trim() ||
      !this.completeAddress.trim() ||
      !this.registerPassword ||
      !this.confirmPassword
    ) {

      this.registerError =
        'Please complete all fields.';

      return;

    }


    if (
      this.registerPassword !==
      this.confirmPassword
    ) {

      this.registerError =
        'Passwords do not match.';

      return;

    }


    if (
      this.registerPassword.length < 6
    ) {

      this.registerError =
        'Password must contain at least 6 characters.';

      return;

    }


    try {

      this.registerLoading = true;


      const result =
        await this.authService.register(
          this.registerEmail.trim(),
          this.registerPassword
        );


      await this.userService.createUserProfile(
        result.user.uid,
        {

          fullName:
            this.fullName.trim(),

          email:
            this.registerEmail
              .trim()
              .toLowerCase(),

          mobileNumber:
            this.mobileNumber.trim(),

          completeAddress:
            this.completeAddress.trim(),

          role:
            'customer'

        }
      );


      // User is no longer browsing as guest
      sessionStorage.removeItem(
        'silkmartGuestMode'
      );


      this.showRegisterPopup = false;


      this.continuePendingOrder();


      this.clearRegisterForm();


    } catch (error: any) {

      console.error(
        'Registration error:',
        error
      );


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


        default:

          this.registerError =
            'Unable to create your account. Please try again.';

          break;

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
  // CONTINUE PENDING ORDER
  // =========================================

  continuePendingOrder(): void {

    if (
      !this.pendingProduct ||
      !this.pendingAction
    ) {

      return;

    }


    const product =
      this.pendingProduct;


    const quantity =
      this.pendingQuantity;


    const action =
      this.pendingAction;


    if (action === 'quick-add') {

      const saved =
        this.saveOrder(
          product,
          quantity
        );


      if (saved) {

        this.addedProduct =
          product;


        this.addSuccessPopup =
          true;

      }

    }


    if (action === 'add-bag') {

      const saved =
        this.saveOrder(
          product,
          quantity
        );


      if (saved) {

        this.addedProduct =
          product;


        this.addSuccessPopup =
          true;


        this.closeProduct();

      }

    }


    if (action === 'order-now') {

      const saved =
        this.saveOrder(
          product,
          quantity
        );


      if (saved) {

        this.closeProduct();


        this.router.navigate([
          '/home-cust/order'
        ]);

      }

    }


    this.pendingProduct = null;

    this.pendingQuantity = 1;

    this.pendingAction = null;

  }


  // =========================================
  // ADD TO CART / QUICK ADD
  // =========================================

  addToCart(product: Product): void {

    const user =
      this.authService.currentUser;


    if (!user) {

      this.openRegisterPopup(
        product,
        1,
        'quick-add'
      );

      return;

    }


    const saved =
      this.saveOrder(
        product,
        1
      );


    if (!saved) {

      return;

    }


    this.addedProduct =
      product;


    this.addSuccessPopup =
      true;

  }


  // =========================================
  // CLOSE ADD SUCCESS POPUP
  // =========================================

  closeAddSuccessPopup(): void {

    this.addSuccessPopup = false;

    this.addedProduct = null;

  }


  // =========================================
  // VIEW ORDERS
  // =========================================

  viewOrders(): void {

    this.closeAddSuccessPopup();


    this.router.navigate([
      '/home-cust/order'
    ]);

  }


  // =========================================
  // ADD PRODUCT FROM POPUP
  // =========================================

  addSelectedProduct(): void {

    if (!this.selectedProduct) {

      return;

    }


    const user =
      this.authService.currentUser;


    if (!user) {

      this.openRegisterPopup(
        this.selectedProduct,
        this.selectedQuantity,
        'add-bag'
      );

      return;

    }


    const product =
      this.selectedProduct;


    const saved =
      this.saveOrder(
        product,
        this.selectedQuantity
      );


    if (!saved) {

      return;

    }


    this.addedProduct =
      product;


    this.addSuccessPopup =
      true;


    this.closeProduct();

  }


  // =========================================
  // ORDER NOW
  // =========================================

  orderSelectedProduct(): void {

    if (!this.selectedProduct) {

      return;

    }


    const user =
      this.authService.currentUser;


    if (!user) {

      this.openRegisterPopup(
        this.selectedProduct,
        this.selectedQuantity,
        'order-now'
      );

      return;

    }


    const saved =
      this.saveOrder(
        this.selectedProduct,
        this.selectedQuantity
      );


    if (!saved) {

      return;

    }


    this.closeProduct();


    this.router.navigate([
      '/home-cust/order'
    ]);

  }


  // =========================================
  // SAVE ORDER
  // =========================================

  saveOrder(
    product: Product,
    quantity: number
  ): boolean {

    // =====================================
    // CURRENT FIREBASE USER
    // =====================================

    const currentUser =
      this.authService.currentUser;


    // =====================================
    // DO NOT SAVE AS GUEST
    // =====================================

    if (!currentUser) {

      console.warn(
        'Order was not saved because there is no authenticated user.'
      );

      return false;

    }


    // =====================================
    // READ EXISTING ORDERS
    // =====================================

    const savedOrders =
      localStorage.getItem(
        'silkOrders'
      );


    let orders: any[] = [];


    if (savedOrders) {

      try {

        orders =
          JSON.parse(
            savedOrders
          );


        if (!Array.isArray(orders)) {

          orders = [];

        }


      } catch {

        orders = [];

      }

    }


    // =====================================
    // CREATE ORDER
    // =====================================

    const order = {

      id:
        Date.now(),


      // ===================================
      // IMPORTANT:
      // FIREBASE ACCOUNT OWNER
      // ===================================

      userId:
        currentUser.uid,


      name:
        product.name,


      category:
        product.category,


      price:
        product.price,


      quantity:
        quantity,


      total:
        product.price *
        quantity,


      stock:
        product.stock,


      status:
        'Processing',


      orderDate:
        new Date()
          .toLocaleDateString(),


      artClass:
        product.artClass

    };


    // =====================================
    // SAVE ORDER
    // =====================================

    orders.push(
      order
    );


    localStorage.setItem(
      'silkOrders',
      JSON.stringify(
        orders
      )
    );


    return true;

  }


  // =========================================
  // FIND YOUR PIECE BUTTON
  // =========================================

  scrollToCollection(): void {

    window.scrollTo({

      top: 0,

      behavior: 'smooth'

    });

  }


  // =========================================
  // TRACK ORDER BUTTON
  // =========================================

  trackOrder(): void {

    console.log(
      'Track an order clicked'
    );

  }

}