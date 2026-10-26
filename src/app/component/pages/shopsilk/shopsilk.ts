
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
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  Firestore,
  collection,
  collectionData,
  query,
  where
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import { AuthServ } from '../../../services/auth.serv';
import { UserServ } from '../../../services/user.serv';
import { OrderServ } from '../../../services/order.serv';

interface ProductColorStock {
  name: string;
  quantity: number;
}

interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  price: number;
  stock: number;
  featured: boolean;
  artClass: string;
  colorStocks: ProductColorStock[];
}

interface ProductColor {
  name: string;
  hex: string;
  quantity: number;
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
  styleUrl: './shopsilk.scss'
})
export class Shopsilk implements OnInit, OnDestroy {
  products: Product[] = [];
  loadingProducts = true;
  productsError = '';

  private productsSubscription: Subscription | null = null;

  searchTerm = '';
  selectedCategory = 'All pieces';
  sortOption = 'featured';

  selectedProduct: Product | null = null;
  selectedQuantity = 1;

  private readonly colorPalette = [
    { name: 'White', hex: '#ffffff' },
    { name: 'Black', hex: '#242424' },
    { name: 'Red', hex: '#cc4e4e' },
    { name: 'Pink', hex: '#ed9eb9' },
    { name: 'Orange', hex: '#e99b56' },
    { name: 'Yellow', hex: '#eacb59' },
    { name: 'Green', hex: '#679e75' },
    { name: 'Blue', hex: '#679acf' },
    { name: 'Purple', hex: '#9875b5' },
    { name: 'Brown', hex: '#98765d' },
    { name: 'Beige', hex: '#d6bfa1' },
    { name: 'Gray', hex: '#a5a8a8' }
  ];

  selectedColors: string[] = [];
  confirmationColors: string[] = [];
  confirmationOrderColors: string[] = [];
  pendingColors: string[] = [];

  showAddBagConfirmation = false;
  confirmationProduct: Product | null = null;
  confirmationQuantity = 1;

  showOrderConfirmation = false;
  confirmationOrderProduct: Product | null = null;
  confirmationOrderQuantity = 1;

  preferredDeliveryDate = '';
  minDeliveryDate = this.getEarliestDeliveryDate();
  orderSaving = false;

  addSuccessPopup = false;
  addedProduct: Product | null = null;

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

  pendingProduct: Product | null = null;
  pendingQuantity = 1;
  pendingAction: PendingAction = null;

  constructor(
    private router: Router,
    private authService: AuthServ,
    private userService: UserServ,
    private orderService: OrderServ,
    private firestore: Firestore,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadPublishedProducts();
  }

  ngOnDestroy(): void {
    this.productsSubscription?.unsubscribe();
  }

  // =========================================
  // FIRESTORE PRODUCTS
  // =========================================

  loadPublishedProducts(): void {
    this.productsSubscription?.unsubscribe();

    this.loadingProducts = true;
    this.productsError = '';

    this.productsSubscription = runInInjectionContext(
      this.injector,
      () => {
        const productsRef = collection(
          this.firestore,
          'products'
        );

        const publishedProductsQuery = query(
          productsRef,
          where('published', '==', true),
          where('stock', '>', 0)
        );

        return collectionData(
          publishedProductsQuery,
          { idField: 'id' }
        ).subscribe({
          next: (records: any[]) => this.zone.run(() => {
            this.products = records.map(record => {
              const colorStocks: ProductColorStock[] =
                Array.isArray(record.colorStocks)
                  ? record.colorStocks
                      .filter((color: any) => {
                        const quantity = Number(color?.quantity);

                        return (
                          typeof color?.name === 'string' &&
                          color.name.trim().length > 0 &&
                          Number.isInteger(quantity) &&
                          quantity >= 0
                        );
                      })
                      .map((color: any) => ({
                        name: String(color.name),
                        quantity: Number(color.quantity)
                      }))
                  : [];

              return {
                id: String(record.id || ''),
                name: String(record.name || ''),
                category: String(record.category || 'Other'),
                description: String(record.description || ''),
                imageUrl: String(record.imageUrl || ''),
                price: Number(record.price || 0),
                stock: Number(record.stock || 0),
                featured: record.featured === true,
                artClass: '',
                colorStocks
              };
            });

            if (this.selectedProduct) {
              const selectedId = this.selectedProduct.id;

              this.selectedProduct =
                this.products.find(
                  product => product.id === selectedId
                ) || null;

              if (this.selectedProduct) {
                this.selectedColors =
                  this.validSelectedColors(
                    this.selectedProduct,
                    this.selectedColors
                  );

                this.normalizeQuantity();
              } else {
                this.selectedColors = [];
              }
            }

            if (
              this.selectedCategory !== 'All pieces' &&
              !this.categories.includes(this.selectedCategory)
            ) {
              this.selectedCategory = 'All pieces';
            }

            this.loadingProducts = false;
            this.productsError = '';

            this.cdr.detectChanges();
          }),

          error: (error: any) => this.zone.run(() => {
            console.error('ShopSilk products error:', error);

            if (error?.code === 'permission-denied') {
              this.productsError =
                'Firebase denied access to the product catalog.';
            } else if (error?.code === 'failed-precondition') {
              this.productsError =
                'Firestore requires the published products index.';
            } else {
              this.productsError =
                'Unable to load products. Please try again.';
            }

            this.loadingProducts = false;
            this.cdr.detectChanges();
          })
        });
      }
    );
  }

  get categories(): string[] {
    return [
      'All pieces',
      ...Array.from(
        new Set(
          this.products.map(product => product.category)
        )
      )
    ];
  }

  getStockUnit(product: Product): string {
    if (product.category === 'Silkworms') return 'worms';
    if (product.category === 'Cocoons') return 'cocoons';

    return 'pcs';
  }

  get filteredProducts(): Product[] {
    let result = [...this.products];

    if (this.selectedCategory !== 'All pieces') {
      result = result.filter(
        product => product.category === this.selectedCategory
      );
    }

    const search = this.searchTerm.trim().toLowerCase();

    if (search) {
      result = result.filter(product =>
        product.name.toLowerCase().includes(search) ||
        product.category.toLowerCase().includes(search) ||
        product.description.toLowerCase().includes(search)
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

      default:
        result.sort(
          (a, b) => Number(b.featured) - Number(a.featured)
        );
        break;
    }

    return result;
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
  }

  // =========================================
  // PRODUCT DETAILS
  // =========================================

  openProduct(product: Product): void {
    this.selectedProduct = product;
    this.selectedQuantity = 1;
    this.selectedColors = [];
  }

  closeProduct(): void {
    this.selectedProduct = null;
    this.selectedQuantity = 1;
    this.selectedColors = [];
  }

  // =========================================
  // ADMIN/STAFF COLOR INVENTORY
  // =========================================

  canChooseColors(product: Product | null): boolean {
    if (!product) return false;

    const category = product.category.trim().toLowerCase();

    return (
      category !== 'silkworms' &&
      category !== 'cocoons' &&
      product.colorStocks.length > 0
    );
  }

  get availableColors(): ProductColor[] {
    if (!this.selectedProduct) return [];

    if (!this.canChooseColors(this.selectedProduct)) {
      return [];
    }

    return this.selectedProduct.colorStocks
      .filter(color => color.quantity > 0)
      .map(color => {
        const paletteColor = this.colorPalette.find(
          item => item.name === color.name
        );

        return {
          name: color.name,
          hex: paletteColor?.hex || '#a5a8a8',
          quantity: color.quantity
        };
      });
  }

  getColorQuantity(
    product: Product,
    colorName: string
  ): number {
    const color = product.colorStocks.find(
      item => item.name === colorName
    );

    return color?.quantity || 0;
  }

  getSelectedColorStock(): number {
    if (!this.selectedProduct) return 0;

    if (!this.canChooseColors(this.selectedProduct)) {
      return this.selectedProduct.stock;
    }

    const selectedColor = this.selectedColors[0];

    if (!selectedColor) return 0;

    return this.getColorQuantity(
      this.selectedProduct,
      selectedColor
    );
  }

  get maximumQuantity(): number {
    if (!this.selectedProduct) return 0;

    return Math.min(
      this.selectedProduct.stock,
      this.getSelectedColorStock()
    );
  }

  private validSelectedColors(
    product: Product,
    colors: string[]
  ): string[] {
    if (!this.canChooseColors(product)) return [];

    const selectedName = colors[0];

    if (!selectedName) return [];

    return this.getColorQuantity(product, selectedName) > 0
      ? [selectedName]
      : [];
  }

  private isValidSelection(
    product: Product,
    quantity: number,
    colors: string[]
  ): boolean {
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > product.stock
    ) {
      return false;
    }

    if (!this.canChooseColors(product)) {
      return true;
    }

    if (colors.length !== 1) {
      return false;
    }

    return (
      this.getColorQuantity(product, colors[0]) >= quantity
    );
  }

  isColorSelected(color: string): boolean {
    return this.selectedColors.includes(color);
  }

  toggleColor(color: string): void {
    if (!this.selectedProduct) return;

    if (!this.canChooseColors(this.selectedProduct)) return;

    const available = this.getColorQuantity(
      this.selectedProduct,
      color
    );

    if (available <= 0) return;

    if (this.selectedColors.includes(color)) {
      this.selectedColors = [];
    } else {
      this.selectedColors = [color];
    }

    this.selectedQuantity = 1;
  }

  clearColors(): void {
    this.selectedColors = [];
    this.selectedQuantity = 1;
  }

  get selectedColorsText(): string {
    return this.selectedColors.join(', ');
  }

  // =========================================
  // QUANTITY CONTROL
  // =========================================

  normalizeQuantity(): void {
    if (!this.selectedProduct) return;

    const maximum = this.maximumQuantity;

    if (maximum < 1) {
      this.selectedQuantity = 1;
      return;
    }

    const quantity = Number(this.selectedQuantity);

    if (!Number.isFinite(quantity) || quantity < 1) {
      this.selectedQuantity = 1;
      return;
    }

    this.selectedQuantity = Math.min(
      Math.floor(quantity),
      maximum
    );
  }

  get quantityValid(): boolean {
    if (!this.selectedProduct) return false;

    return this.isValidSelection(
      this.selectedProduct,
      Number(this.selectedQuantity),
      this.selectedColors
    );
  }

  increaseQuantity(): void {
    if (!this.selectedProduct) return;

    this.normalizeQuantity();

    if (this.selectedQuantity < this.maximumQuantity) {
      this.selectedQuantity++;
    }
  }

  decreaseQuantity(): void {
    this.normalizeQuantity();

    if (this.selectedQuantity > 1) {
      this.selectedQuantity--;
    }
  }

  // =========================================
  // REGISTRATION
  // =========================================

  openRegisterPopup(
    product: Product,
    quantity: number,
    action: Exclude<PendingAction, null>,
    colors: string[] = []
  ): void {
    this.pendingProduct = product;
    this.pendingQuantity = quantity;
    this.pendingAction = action;
    this.pendingColors = [...colors];

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
    this.pendingColors = [];
  }

  toggleRegisterPassword(): void {
    this.showRegisterPassword = !this.showRegisterPassword;
  }

  toggleConfirmPassword(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

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
            'Please check your internet connection.';
          break;

        case 'permission-denied':
        case 'firestore/permission-denied':
          this.registerError =
            'Firebase denied permission to save your profile.';
          break;

        default:
          this.registerError =
            'Unable to create your account. Please try again.';
      }
    } finally {
      this.registerLoading = false;
    }
  }

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

  continuePendingOrder(): void {
    if (!this.pendingProduct || !this.pendingAction) return;

    const latestProduct = this.products.find(
      product => product.id === this.pendingProduct?.id
    );

    const product = latestProduct || this.pendingProduct;
    const quantity = this.pendingQuantity;
    const action = this.pendingAction;
    const colors = [...this.pendingColors];

    this.pendingProduct = null;
    this.pendingQuantity = 1;
    this.pendingAction = null;
    this.pendingColors = [];

    if (!this.isValidSelection(product, quantity, colors)) {
      alert(
        'The selected color or quantity is no longer available.'
      );
      return;
    }

    if (action === 'quick-add' || action === 'order-now') {
      this.openOrderConfirmation(product, quantity, colors);
    }

    if (action === 'add-bag') {
      this.confirmationProduct = product;
      this.confirmationQuantity = quantity;
      this.confirmationColors = colors;
      this.showAddBagConfirmation = true;
    }
  }

  // =========================================
  // PRODUCT CARD
  // =========================================

  addToCart(product: Product): void {
    this.openProduct(product);
  }

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

    this.normalizeQuantity();

    if (!this.quantityValid) return;

    if (!this.authService.currentUser) {
      this.openRegisterPopup(
        this.selectedProduct,
        this.selectedQuantity,
        'add-bag',
        this.selectedColors
      );
      return;
    }

    this.confirmationProduct = this.selectedProduct;
    this.confirmationQuantity = this.selectedQuantity;
    this.confirmationColors = [...this.selectedColors];

    this.showAddBagConfirmation = true;
  }

  closeAddBagConfirmation(): void {
    this.showAddBagConfirmation = false;
    this.confirmationProduct = null;
    this.confirmationQuantity = 1;
    this.confirmationColors = [];
  }

  saveProductToBag(
    product: Product,
    quantity: number,
    colors: string[] = []
  ): boolean {
    const user = this.authService.currentUser;

    if (!user) return false;

    const latestProduct = this.products.find(
      item => item.id === product.id
    );

    if (!latestProduct) return false;

    if (!this.isValidSelection(
      latestProduct,
      quantity,
      colors
    )) {
      return false;
    }

    try {
      const stored = localStorage.getItem('silkCart');
      let cart: any[] = [];

      if (stored) {
        const parsed = JSON.parse(stored);
        cart = Array.isArray(parsed) ? parsed : [];
      }

      const normalizedColors =
        this.canChooseColors(latestProduct)
          ? [...colors]
          : [];

      const existingItem = cart.find(item => {
        if (item.userId !== user.uid) return false;

        const sameProduct = item.productId
          ? item.productId === latestProduct.id
          : item.name === latestProduct.name;

        const previousColors = Array.isArray(item.colors)
          ? [...item.colors].sort()
          : [];

        return sameProduct &&
          JSON.stringify(previousColors) ===
          JSON.stringify([...normalizedColors].sort());
      });

      if (existingItem) {
        const updatedQuantity =
          Number(existingItem.quantity) + quantity;

        if (!this.isValidSelection(
          latestProduct,
          updatedQuantity,
          normalizedColors
        )) {
          return false;
        }

        existingItem.quantity = updatedQuantity;
        existingItem.stock = latestProduct.stock;
        existingItem.productId = latestProduct.id;
        existingItem.imageUrl = latestProduct.imageUrl;
        existingItem.image = latestProduct.imageUrl;
        existingItem.description = latestProduct.description;
        existingItem.colors = normalizedColors;

      } else {
        cart.push({
          id: Date.now(),
          userId: user.uid,
          productId: latestProduct.id,
          name: latestProduct.name,
          category: latestProduct.category,
          price: latestProduct.price,
          quantity,
          stock: latestProduct.stock,
          imageUrl: latestProduct.imageUrl,
          image: latestProduct.imageUrl,
          description: latestProduct.description,
          artClass: latestProduct.artClass,
          colors: normalizedColors,
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
      this.confirmationQuantity,
      this.confirmationColors
    );

    if (!saved) {
      alert(
        'Unable to add this quantity. Please check the selected color and available stock.'
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

    this.normalizeQuantity();

    if (!this.quantityValid) return;

    if (!this.authService.currentUser) {
      this.openRegisterPopup(
        this.selectedProduct,
        this.selectedQuantity,
        'order-now',
        this.selectedColors
      );
      return;
    }

    this.openOrderConfirmation(
      this.selectedProduct,
      this.selectedQuantity,
      this.selectedColors
    );
  }

  openOrderConfirmation(
    product: Product,
    quantity: number,
    colors: string[] = []
  ): void {
    if (this.orderSaving) return;

    const latestProduct = this.products.find(
      item => item.id === product.id
    );

    if (
      !latestProduct ||
      !this.isValidSelection(
        latestProduct,
        quantity,
        colors
      )
    ) {
      alert(
        'The selected color or quantity is no longer available.'
      );
      return;
    }

    this.confirmationOrderProduct = latestProduct;
    this.confirmationOrderQuantity = quantity;

    this.confirmationOrderColors =
      this.canChooseColors(latestProduct)
        ? [...colors]
        : [];

    this.preferredDeliveryDate = '';
    this.minDeliveryDate = this.getEarliestDeliveryDate();
    this.showOrderConfirmation = true;
  }

  closeOrderConfirmation(): void {
    if (this.orderSaving) return;

    this.showOrderConfirmation = false;
    this.confirmationOrderProduct = null;
    this.confirmationOrderQuantity = 1;
    this.confirmationOrderColors = [];
    this.preferredDeliveryDate = '';
  }

  getEarliestDeliveryDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + 1);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  async confirmOrderNow(): Promise<void> {
    if (
      this.orderSaving ||
      !this.confirmationOrderProduct
    ) {
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
    const preferredDeliveryDate = this.preferredDeliveryDate;
    const colors = [...this.confirmationOrderColors];

    this.orderSaving = true;

    try {
      await this.saveOrder(
        product,
        quantity,
        preferredDeliveryDate,
        colors
      );

      this.showOrderConfirmation = false;
      this.confirmationOrderProduct = null;
      this.confirmationOrderQuantity = 1;
      this.confirmationOrderColors = [];
      this.preferredDeliveryDate = '';

      this.closeProduct();

      await this.router.navigate(['/home-cust/order']);

    } catch (error: any) {
      console.error('Firebase order error:', error);

      let message =
        error?.message ||
        'Unable to place your order. Please try again.';

      if (error?.code === 'permission-denied') {
        message =
          'Firebase denied the order. Check your Firestore rules.';
      }

      if (error?.code === 'unavailable') {
        message =
          'Firebase is unavailable. Check your internet connection.';
      }

      alert(message);

    } finally {
      this.orderSaving = false;
    }
  }

  async saveOrder(
    product: Product,
    quantity: number,
    preferredDeliveryDate: string,
    colors: string[] = []
  ): Promise<string> {
    if (!this.authService.currentUser) {
      throw new Error(
        'Please sign in before placing an order.'
      );
    }

    const latestProduct = this.products.find(
      item => item.id === product.id
    );

    if (
      !latestProduct ||
      !this.isValidSelection(
        latestProduct,
        quantity,
        colors
      )
    ) {
      throw new Error(
        'The selected color or quantity is no longer available.'
      );
    }

    const notes =
      this.canChooseColors(latestProduct) && colors.length
        ? `Selected product color: ${colors[0]}.`
        : '';

    return await this.orderService.createOrder({
      items: [
        {
          name: latestProduct.name,
          category: latestProduct.category,
          price: latestProduct.price,
          quantity,
          image: latestProduct.imageUrl,
          artClass: latestProduct.artClass
        }
      ],
      preferredDeliveryDate,
      deliveryFee: 0,
      notes
    });
  }

  scrollToCollection(): void {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  trackOrder(): void {
    this.router.navigate(['/home-cust/order']);
  }
}
