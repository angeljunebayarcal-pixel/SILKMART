
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

import {
  Auth,
  onAuthStateChanged
} from '@angular/fire/auth';

import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc
} from '@angular/fire/firestore';

import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

type ProductStatusFilter =
  | 'All'
  | 'Published'
  | 'Draft'
  | 'Out of Stock';

interface ShopProduct {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
  published: boolean;
  featured: boolean;
  createdAt: any;
  updatedAt: any;
}

interface ProductForm {
  name: string;
  category: string;
  description: string;
  price: number | null;
  stock: number | null;
  imageUrl: string;
  published: boolean;
  featured: boolean;
}

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './products.html',
  styleUrl: './products.scss'
})
export class Products implements OnInit, OnDestroy {

  private readonly productCollection;

  private authUnsubscribe: (() => void) | null = null;
  private productsSubscription: Subscription | null = null;

  currentUserId = '';
  loading = true;
  saving = false;
  errorMessage = '';

  products: ShopProduct[] = [];
  selectedProduct: ShopProduct | null = null;

  searchTerm = '';
  categoryFilter = 'All Categories';
  statusFilter: ProductStatusFilter = 'All';
  stockFilter = 'All Stock';
  sortBy = 'newest';

  showProductModal = false;
  editingProductId: string | null = null;
  formError = '';

  productForm: ProductForm = this.emptyForm();

  readonly categories = [
    'Silkworms',
    'Scarves',
    'Sleepwear',
    'Shawls',
    'Home & Living',
    'Accessories',
    'Fabrics',
    'Ribbons & Trim',
    'Silk Thread',
    'Other'
  ];

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {
    this.productCollection = runInInjectionContext(
      this.injector,
      () => collection(this.firestore, 'products')
    );
  }

  private inContext<T>(callback: () => T): T {
    return runInInjectionContext(
      this.injector,
      callback
    );
  }

  private refresh(): void {
    this.cdr.detectChanges();
  }

  ngOnInit(): void {
    this.authUnsubscribe = this.inContext(() =>
      onAuthStateChanged(
        this.auth,
        user => this.zone.run(() => {
          this.productsSubscription?.unsubscribe();
          this.productsSubscription = null;

          this.currentUserId = user?.uid || '';

          if (!user) {
            this.products = [];
            this.selectedProduct = null;
            this.loading = false;
            this.errorMessage =
              'Please sign in with an Admin or Staff account.';
            this.refresh();
            return;
          }

          this.loadProducts();
        }),
        error => this.zone.run(() => {
          console.error(error);
          this.loading = false;
          this.errorMessage =
            'Unable to verify your Firebase account.';
          this.refresh();
        })
      )
    );
  }

  ngOnDestroy(): void {
    this.productsSubscription?.unsubscribe();
    this.authUnsubscribe?.();
  }

  // =========================================
  // FIRESTORE CATALOG
  // =========================================

  loadProducts(): void {
    if (!this.currentUserId) return;

    this.productsSubscription?.unsubscribe();

    this.loading = true;
    this.errorMessage = '';

    const uid = this.currentUserId;

    this.productsSubscription = this.inContext(() =>
      collectionData(
        this.productCollection,
        { idField: 'id' }
      ).subscribe({
        next: records => this.zone.run(() => {
          if (uid !== this.currentUserId) return;

          this.products = records.map(
            record => this.normalizeProduct(record)
          );

          if (this.selectedProduct) {
            this.selectedProduct =
              this.products.find(
                item =>
                  item.id === this.selectedProduct?.id
              ) || null;
          }

          this.loading = false;
          this.errorMessage = '';
          this.refresh();
        }),

        error: error => this.zone.run(() => {
          console.error('Products load error:', error);

          this.loading = false;
          this.errorMessage =
            error?.code === 'permission-denied'
              ? 'Firebase denied access. Check your Staff/Admin role and product security rules.'
              : 'Unable to load products from Firebase.';

          this.refresh();
        })
      })
    );
  }

  private normalizeProduct(raw: any): ShopProduct {
    return {
      id: String(raw.id || ''),
      name: String(raw.name || ''),
      category: String(raw.category || 'Other'),
      description: String(raw.description || ''),
      price: Number(raw.price || 0),
      stock: Number(raw.stock || 0),
      imageUrl: String(raw.imageUrl || ''),
      published: raw.published === true,
      featured: raw.featured === true,
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null
    };
  }

  // =========================================
  // SILKWORM PRODUCT HELPERS
  // =========================================

  isSilkwormProduct(
    product: ShopProduct | ProductForm
  ): boolean {
    return product.category === 'Silkworms';
  }

  getStockUnit(
    product: ShopProduct | ProductForm
  ): string {
    return this.isSilkwormProduct(product)
      ? 'worms'
      : 'pcs';
  }

  // =========================================
  // SUMMARY CARDS
  // =========================================

  get totalProducts(): number {
    return this.products.length;
  }

  get publishedProducts(): number {
    return this.products.filter(
      item => item.published && item.stock > 0
    ).length;
  }

  get draftProducts(): number {
    return this.products.filter(
      item => !item.published
    ).length;
  }

  get outOfStockProducts(): number {
    return this.products.filter(
      item => item.stock <= 0
    ).length;
  }

  // =========================================
  // FILTER / SORT
  // =========================================

  get filteredProducts(): ShopProduct[] {
    const term = this.searchTerm
      .trim()
      .toLowerCase();

    return this.products
      .filter(product => {
        const text = [
          product.name,
          product.category,
          product.description,
          product.id
        ].join(' ').toLowerCase();

        const matchesSearch =
          !term || text.includes(term);

        const matchesCategory =
          this.categoryFilter === 'All Categories' ||
          this.categoryFilter === product.category;

        let matchesStatus = true;

        if (this.statusFilter === 'Published') {
          matchesStatus = product.published;
        } else if (this.statusFilter === 'Draft') {
          matchesStatus = !product.published;
        } else if (this.statusFilter === 'Out of Stock') {
          matchesStatus = product.stock <= 0;
        }

        let matchesStock = true;

        if (this.stockFilter === 'In Stock') {
          matchesStock = product.stock > 0;
        } else if (this.stockFilter === 'Low Stock') {
          const threshold =
            this.isSilkwormProduct(product) ? 10 : 100;

          matchesStock =
            product.stock > 0 &&
            product.stock <= threshold;
        } else if (this.stockFilter === 'Out of Stock') {
          matchesStock = product.stock <= 0;
        }

        return (
          matchesSearch &&
          matchesCategory &&
          matchesStatus &&
          matchesStock
        );
      })
      .sort((a, b) => {
        switch (this.sortBy) {
          case 'oldest':
            return (
              this.toMillis(a.createdAt) -
              this.toMillis(b.createdAt)
            );

          case 'name':
            return a.name.localeCompare(b.name);

          case 'priceLow':
            return a.price - b.price;

          case 'priceHigh':
            return b.price - a.price;

          case 'stockLow':
            return a.stock - b.stock;

          default:
            return (
              this.toMillis(b.createdAt) -
              this.toMillis(a.createdAt)
            );
        }
      });
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.categoryFilter = 'All Categories';
    this.statusFilter = 'All';
    this.stockFilter = 'All Stock';
    this.sortBy = 'newest';
  }

  trackProduct(
    index: number,
    product: ShopProduct
  ): string {
    return product.id;
  }

  selectProduct(product: ShopProduct): void {
    this.selectedProduct = product;
  }

  // =========================================
  // PRODUCT FORM
  // =========================================

  private emptyForm(): ProductForm {
    return {
      name: '',
      category: 'Scarves',
      description: '',
      price: null,
      stock: null,
      imageUrl: '',
      published: false,
      featured: false
    };
  }

  openAddProduct(): void {
    this.editingProductId = null;
    this.productForm = this.emptyForm();
    this.formError = '';
    this.showProductModal = true;
  }

  createListing(): void {
    this.openAddProduct();
    this.productForm.published = false;
  }

  openEditProduct(product: ShopProduct): void {
    this.selectedProduct = product;
    this.editingProductId = product.id;

    this.productForm = {
      name: product.name,
      category: product.category,
      description: product.description,
      price: product.price,
      stock: product.stock,
      imageUrl: product.imageUrl,
      published: product.published,
      featured: product.featured
    };

    this.formError = '';
    this.showProductModal = true;
  }

  closeProductModal(): void {
    if (this.saving) return;

    this.showProductModal = false;
    this.editingProductId = null;
    this.formError = '';
  }

  // =========================================
  // IMAGE VALIDATION
  // =========================================

  private validImage(image: string): boolean {
    const value = image.trim();

    if (!value) return true;

    if (
      value.startsWith('data:image/jpeg;base64,')
    ) {
      return (
        value.length <= 180000 &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/
          .test(value)
      );
    }

    if (value.length > 2048) return false;

    try {
      const url = new URL(value);
      return (
        url.protocol === 'http:' ||
        url.protocol === 'https:'
      );
    } catch {
      return false;
    }
  }

  private validateForm(): string {
    const form = this.productForm;

    if (!form.name.trim()) {
      return 'Please enter a product name.';
    }

    if (form.name.trim().length > 120) {
      return 'Product name must be 120 characters or fewer.';
    }

    if (!this.categories.includes(form.category)) {
      return 'Please select a valid category.';
    }

    if (form.description.length > 2000) {
      return 'Description must be 2,000 characters or fewer.';
    }

    if (
      form.price === null ||
      !Number.isFinite(Number(form.price)) ||
      Number(form.price) < 0
    ) {
      return 'Please enter a valid selling price.';
    }

    if (
      form.stock === null ||
      !Number.isInteger(Number(form.stock)) ||
      Number(form.stock) < 0
    ) {
      return 'Stock must be a whole number of zero or more.';
    }

    if (!this.validImage(form.imageUrl)) {
      return 'Please provide a valid image URL or compressed Base64 JPEG image.';
    }

    if (form.published && Number(form.stock) <= 0) {
      return 'Add available stock before publishing this product.';
    }

    return '';
  }

  // =========================================
  // SAVE PRODUCT
  // =========================================

  async saveProduct(): Promise<void> {
    if (this.saving) return;

    this.formError = this.validateForm();
    if (this.formError) return;

    if (!this.currentUserId) {
      this.formError =
        'Please sign in before saving a product.';
      return;
    }

    const form = this.productForm;

    const data = {
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim(),
      price: Number(form.price),
      stock: Number(form.stock),
      imageUrl: form.imageUrl.trim(),
      published: form.published,
      featured: form.featured,
      updatedAt: serverTimestamp()
    };

    this.saving = true;
    this.refresh();

    try {
      if (this.editingProductId) {
        const productId = this.editingProductId;

        await this.inContext(() =>
          updateDoc(
            doc(this.firestore, 'products', productId),
            data
          )
        );
      } else {
        const reference = this.inContext(() =>
          doc(this.productCollection)
        );

        await this.inContext(() =>
          setDoc(reference, {
            ...data,
            id: reference.id,
            createdAt: serverTimestamp()
          })
        );

        this.selectedProduct = {
          ...data,
          id: reference.id,
          createdAt: new Date()
        };
      }

      this.showProductModal = false;
      this.editingProductId = null;
      this.formError = '';

      await Swal.fire({
        icon: 'success',
        title: 'Product Saved',
        text: data.published
          ? 'Your product is published in the catalog.'
          : 'Your product is saved as a draft.',
        confirmButtonColor: '#287457',
        timer: 1700,
        showConfirmButton: false
      });

    } catch (error: any) {
      console.error('Product save failed:', error);

      this.formError =
        error?.code === 'permission-denied'
          ? 'Firebase denied this action. Check your Staff/Admin permissions and Firestore rules.'
          : error?.message || 'Unable to save the product.';

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // PUBLISH / UNPUBLISH
  // =========================================

  async togglePublish(
    product: ShopProduct
  ): Promise<void> {
    if (this.saving) return;

    const publish = !product.published;

    if (publish && product.stock <= 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'Stock Required',
        text: 'Add stock before publishing this product.',
        confirmButtonColor: '#287457'
      });
      return;
    }

    const result = await Swal.fire({
      icon: 'question',
      title: publish
        ? 'Publish this product?'
        : 'Unpublish this product?',
      text: publish
        ? `${product.name} will be eligible to appear in ShopSilk.`
        : `${product.name} will be hidden from the customer catalog.`,
      showCancelButton: true,
      confirmButtonText: publish
        ? 'Publish Product'
        : 'Unpublish',
      confirmButtonColor: '#287457',
      reverseButtons: true
    });

    if (!result.isConfirmed) return;

    this.saving = true;

    try {
      await this.inContext(() =>
        updateDoc(
          doc(this.firestore, 'products', product.id),
          {
            published: publish,
            updatedAt: serverTimestamp()
          }
        )
      );

    } catch (error: any) {
      await Swal.fire({
        icon: 'error',
        title: 'Unable to Update Product',
        text: error?.message || 'Please try again.',
        confirmButtonColor: '#287457'
      });

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // DELETE PRODUCT
  // =========================================

  async deleteProduct(
    product: ShopProduct
  ): Promise<void> {
    if (this.saving) return;

    const result = await Swal.fire({
      icon: 'warning',
      title: 'Delete Product?',
      text: `Permanently delete ${product.name} from the catalog?`,
      showCancelButton: true,
      confirmButtonText: 'Delete Product',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#c74f54',
      reverseButtons: true
    });

    if (!result.isConfirmed) return;

    this.saving = true;

    try {
      await this.inContext(() =>
        deleteDoc(
          doc(this.firestore, 'products', product.id)
        )
      );

      if (this.selectedProduct?.id === product.id) {
        this.selectedProduct = null;
      }

      await Swal.fire({
        icon: 'success',
        title: 'Product Deleted',
        text: 'The product has been removed from Firestore.',
        timer: 1500,
        showConfirmButton: false
      });

    } catch (error: any) {
      await Swal.fire({
        icon: 'error',
        title: 'Delete Failed',
        text: error?.message || 'Unable to delete product.',
        confirmButtonColor: '#287457'
      });

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // DISPLAY HELPERS
  // =========================================

  getStatusText(product: ShopProduct): string {
    if (product.stock <= 0) return 'Out of Stock';
    return product.published ? 'Published' : 'Draft';
  }

  getStatusClass(product: ShopProduct): string {
    if (product.stock <= 0) return 'status-out';

    return product.published
      ? 'status-published'
      : 'status-draft';
  }

  getProductInitials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(word => word[0])
      .join('')
      .toUpperCase() || 'SM';
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

  formatDate(value: any): string {
    const millis = this.toMillis(value);

    if (!millis) return 'Just now';

    return new Date(millis).toLocaleString('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }
}
