
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
import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  runTransaction,
  serverTimestamp,
  writeBatch
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

type InventoryKind = 'species' | 'product';
type ActivityType = 'add' | 'edit' | 'remove' | 'stock' | 'cocoon';
type ProductionPeriod = 'daily' | 'monthly';
type ProductionKey = 'silkworms' | 'products' | 'cocoons';

interface Species {
  id: string;
  name: string;
  scientificName: string;
  stage: string;
  condition: string;
  quantity: number;
  threshold: number;
  imageUrl: string;
}


interface ProductColorStock {
  name: string;
  quantity: number;
}


interface SilkProduct {
  id: string;
  name: string;
  category: string;
  description: string;
  quantity: number;
  threshold: number;
  price: number;
  unit: string;
  imageUrl: string;
  published: boolean;
  featured: boolean;
  colorStocks: ProductColorStock[];

}

interface Cocoons {
  good: number;
  minor: number;
  unusable: number;
  reserved: number;
  imageUrl: string;
}

interface Activity {
  id: string;
  message: string;
  detail: string;
  type: ActivityType;
  actorUid: string;
  createdAt: any;
}

interface StockAlert {
  name: string;
  quantity: number;
  threshold: number;
  unit: string;
}

interface ProductionTotals {
  silkworms: number;
  products: number;
  cocoons: number;
}

interface ProductionPoint extends ProductionTotals {
  label: string;
  date: Date;
  x: number;
}

interface ProductionSeries {
  key: ProductionKey;
  name: string;
  color: string;
  points: string;
  total: number;
}

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory.html',
  styleUrl: './inventory.scss'
})
export class Inventory implements OnInit, OnDestroy {

  currentUserId = '';
  loading = true;
  saving = false;
  processingImage = false;
  errorMessage = '';
  imageError = '';

  species: Species[] = [];
  products: SilkProduct[] = [];
  cocoons: Cocoons = this.emptyCocoons();
  activities: Activity[] = [];

  searchSpecies = '';
  searchProducts = '';
  productFilter = 'All';

  showEditor = false;
  editorKind: InventoryKind = 'species';
  editingId: string | null = null;

  speciesForm: Species = this.emptySpecies();
  productForm: SilkProduct = this.emptyProduct();

  showCocoonEditor = false;
  cocoonGoodChange = 0;
  cocoonMinorChange = 0;
  cocoonUnusableChange = 0;
  cocoonImageUrl = '';

  showAllActivity = false;
  showProductionStatistics = false;
  productionPeriod: ProductionPeriod = 'daily';

  readonly maxImageBytes = 5 * 1024 * 1024;
  readonly maxBase64Length = 180000;

  readonly stages = [
    'Egg',
    '1st Instar',
    '2nd Instar',
    '3rd Instar',
    '4th Instar',
    '5th Instar',
    'Mature',
    'Pupa',
    'Moth'
  ];

  readonly conditions = [
    'Healthy',
    'Good',
    'Monitoring',
    'Quarantined'
  ];

  readonly productCategories = [
    'Silkworms',
    'Cocoons',
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

  
  readonly availableProductColors = [
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


  readonly graphLeft = 68;
  readonly graphRight = 710;
  readonly graphTop = 25;
  readonly graphBottom = 260;

  readonly productionLines: {
    key: ProductionKey;
    name: string;
    color: string;
  }[] = [
    {
      key: 'silkworms',
      name: 'Silkworms',
      color: '#28785b'
    },
    {
      key: 'products',
      name: 'Products',
      color: '#d9a24a'
    },
    {
      key: 'cocoons',
      name: 'Cocoons',
      color: '#6395c5'
    }
  ];

  private stopAuthListener: (() => void) | null = null;
  private subscriptions: Subscription[] = [];
  private session = 0;

  constructor(
    private auth: Auth,
    private firestore: Firestore,
    private router: Router,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  private inContext<T>(callback: () => T): T {
    return runInInjectionContext(this.injector, callback);
  }

  private refresh(): void {
    this.cdr.detectChanges();
  }

  ngOnInit(): void {
    this.stopAuthListener = this.inContext(() =>
      onAuthStateChanged(
        this.auth,
        user => this.zone.run(() => {
          this.session++;
          this.stopSubscriptions();

          this.currentUserId = user?.uid || '';
          this.species = [];
          this.products = [];
          this.cocoons = this.emptyCocoons();
          this.activities = [];
          this.errorMessage = '';

          if (!user) {
            this.loading = false;
            this.errorMessage =
              'Sign in with an Admin or Staff account.';
            this.refresh();
            return;
          }

          this.listenToInventory(this.session);
        }),
        error => this.zone.run(() => {
          console.error('Authentication error:', error);
          this.loading = false;
          this.errorMessage =
            'Unable to verify your account.';
          this.refresh();
        })
      )
    );
  }

  ngOnDestroy(): void {
    this.session++;
    this.stopSubscriptions();
    this.stopAuthListener?.();
  }

  private stopSubscriptions(): void {
    this.subscriptions.forEach(
      subscription => subscription.unsubscribe()
    );
    this.subscriptions = [];
  }

  private listenToInventory(session: number): void {
    this.loading = true;
    this.errorMessage = '';

    const loaded = new Set<string>();

    const attach = (
      key: string,
      source: any,
      callback: (data: any) => void
    ): void => {
      const subscription: Subscription = source.subscribe({
        next: (data: any) => this.zone.run(() => {
          if (session !== this.session) return;

          callback(data);
          loaded.add(key);

          if (loaded.size === 4) {
            this.loading = false;
          }

          this.refresh();
        }),

        error: (error: any) => this.zone.run(() => {
          if (session !== this.session) return;

          console.error('Inventory listener error:', error);
          this.loading = false;

          this.errorMessage =
            error?.code === 'permission-denied'
              ? 'Firebase access denied. Check Admin/Staff permissions and Firestore rules.'
              : 'Unable to load inventory from Firebase.';

          this.refresh();
        })
      });

      this.subscriptions.push(subscription);
    };

    this.inContext(() => {

      attach(
        'species',
        collectionData(
          collection(this.firestore, 'inventory_species'),
          { idField: 'id' }
        ),
        (records: any[]) => {
          this.species = records.map(item => ({
            id: String(item.id || ''),
            name: String(item.name || ''),
            scientificName: String(item.scientificName || ''),
            stage: String(item.stage || 'Egg'),
            condition: String(item.condition || 'Healthy'),
            quantity: Number(item.quantity || 0),
            threshold: Number(item.threshold ?? 10),
            imageUrl: String(item.imageUrl || '')
          }));
        }
      );

      attach(
        'products',
        collectionData(
          collection(this.firestore, 'products'),
          { idField: 'id' }
        ),
        (records: any[]) => {
          this.products = records.map(item => {
            const category = String(
              item.category || 'Other'
            );

            return {
              id: String(item.id || ''),
              name: String(item.name || ''),
              category,
              description: String(item.description || ''),
              quantity: Number(item.stock || 0),
              threshold:
                category === 'Silkworms' ? 10 : 100,
              price: Number(item.price || 0),
              unit:
                category === 'Silkworms'
                  ? 'worms'
                  : category === 'Cocoons'
                    ? 'cocoons'
                    : 'pcs',
                    
              imageUrl: String(item.imageUrl || ''),
              published: item.published === true,
              featured: item.featured === true,
              colorStocks: Array.isArray(item.colorStocks)
                ? item.colorStocks
                    .filter((color: any) =>
                      typeof color?.name === 'string' &&
                      Number.isInteger(Number(color.quantity)) &&
                      Number(color.quantity) >= 0
                    )
                    .map((color: any) => ({
                      name: String(color.name),
                      quantity: Number(color.quantity)
                    }))
                : []
            };
          });
        }
      );

      attach(
        'cocoons',
        docData(
          doc(this.firestore, 'inventory', 'cocoons')
        ),
        (record: any) => {
          this.cocoons = record
            ? {
                good: Number(record.good || 0),
                minor: Number(record.minor || 0),
                unusable: Number(record.unusable || 0),
                reserved: Number(record.reserved || 0),
                imageUrl: String(record.imageUrl || '')
              }
            : this.emptyCocoons();
        }
      );

      attach(
        'activity',
        collectionData(
          collection(this.firestore, 'inventory_activity'),
          { idField: 'id' }
        ),
        (records: any[]) => {
          this.activities = records.map(item => ({
            id: String(item.id || ''),
            message: String(item.message || ''),
            detail: String(item.detail || ''),
            type: item.type || 'edit',
            actorUid: String(item.actorUid || ''),
            createdAt: item.createdAt
          }));
        }
      );
    });
  }

  reload(): void {
    if (!this.currentUserId) return;

    this.session++;
    this.stopSubscriptions();
    this.listenToInventory(this.session);
  }

  private emptySpecies(): Species {
    return {
      id: '',
      name: '',
      scientificName: '',
      stage: 'Egg',
      condition: 'Healthy',
      quantity: 0,
      threshold: 10,
      imageUrl: ''
    };
  }

  private emptyProduct(): SilkProduct {
    return {
      id: '',
      name: '',
      category: 'Scarves',
      description: '',
      quantity: 0,
      threshold: 100,
      price: 0,
      unit: 'pcs',
      imageUrl: '',
      published: false,
      featured: false,
      colorStocks: []

    };
  }

  
  canManageProductColors(): boolean {
    const category = this.productForm.category
      .trim()
      .toLowerCase();

    return category !== 'silkworms' &&
      category !== 'cocoons';
  }

  hasProductColorStock(): boolean {
    return this.canManageProductColors() &&
      this.productForm.colorStocks.length > 0;
  }

  hasSelectedProductColor(name: string): boolean {
    return this.productForm.colorStocks.some(
      color => color.name === name
    );
  }

  toggleProductColor(name: string): void {
    if (!this.canManageProductColors()) return;

    const exists = this.hasSelectedProductColor(name);

    if (exists) {
      this.productForm.colorStocks =
        this.productForm.colorStocks.filter(
          color => color.name !== name
        );
    } else {
      this.productForm.colorStocks.push({
        name,
        quantity: 0
      });
    }

    this.syncProductColorTotal();
  }

  setProductColorQuantity(
    name: string,
    value: number | string
  ): void {
    const color = this.productForm.colorStocks.find(
      item => item.name === name
    );

    if (!color) return;

    color.quantity = Number(value);
    this.syncProductColorTotal();
  }

  get productColorStockTotal(): number {
    return this.productForm.colorStocks.reduce(
      (total, color) => {
        const quantity = Number(color.quantity);

        return total +
          (Number.isInteger(quantity) && quantity > 0
            ? quantity
            : 0);
      },
      0
    );
  }

  
  syncProductColorTotal(): void {
    if (!this.canManageProductColors()) {
      return;
    }

    this.productForm.quantity =
      this.productColorStockTotal;
  }

  private emptyCocoons(): Cocoons {
    return {
      good: 0,
      minor: 0,
      unusable: 0,
      reserved: 0,
      imageUrl: ''
    };
  }

  // =========================================
  // IMAGE UPLOAD
  // =========================================

  async onImageSelected(
    event: Event,
    target: 'species' | 'product' | 'cocoon'
  ): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    this.imageError = '';

    if (![
      'image/jpeg',
      'image/png',
      'image/webp'
    ].includes(file.type)) {
      this.imageError =
        'Only JPG, PNG, or WebP images are allowed.';
      input.value = '';
      return;
    }

    if (file.size > this.maxImageBytes) {
      this.imageError =
        'Please select an image smaller than 5 MB.';
      input.value = '';
      return;
    }

    this.processingImage = true;
    this.refresh();

    try {
      const base64 = await this.compressImage(file);

      this.zone.run(() => {
        if (target === 'species') {
          this.speciesForm.imageUrl = base64;
        } else if (target === 'product') {
          this.productForm.imageUrl = base64;
        } else {
          this.cocoonImageUrl = base64;
        }

        this.imageError = '';
        this.processingImage = false;
        this.refresh();
      });

    } catch (error: any) {
      this.zone.run(() => {
        this.imageError =
          error?.message ||
          'Unable to process this image.';
        this.processingImage = false;
        this.refresh();
      });

    } finally {
      input.value = '';
    }
  }

  private compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');

          if (!context) {
            throw new Error(
              'Image processing is unavailable.'
            );
          }

          let maximumSide = 700;

          for (let attempt = 0; attempt < 8; attempt++) {
            const ratio = Math.min(
              1,
              maximumSide /
                Math.max(
                  image.naturalWidth,
                  image.naturalHeight
                )
            );

            canvas.width = Math.max(
              1,
              Math.round(
                image.naturalWidth * ratio
              )
            );

            canvas.height = Math.max(
              1,
              Math.round(
                image.naturalHeight * ratio
              )
            );

            context.fillStyle = '#ffffff';
            context.fillRect(
              0, 0,
              canvas.width,
              canvas.height
            );

            context.drawImage(
              image,
              0,
              0,
              canvas.width,
              canvas.height
            );

            const quality = Math.max(
              0.35,
              0.78 - attempt * 0.06
            );

            const output = canvas.toDataURL(
              'image/jpeg',
              quality
            );

            if (
              output.length <= this.maxBase64Length
            ) {
              URL.revokeObjectURL(objectUrl);
              resolve(output);
              return;
            }

            maximumSide = Math.max(
              120,
              Math.round(maximumSide * 0.78)
            );
          }

          throw new Error(
            'Compressed image is still too large.'
          );

        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(
          new Error(
            'Unable to read the selected image.'
          )
        );
      };

      image.src = objectUrl;
    });
  }

  removeImage(
    target: 'species' | 'product' | 'cocoon'
  ): void {
    if (target === 'species') {
      this.speciesForm.imageUrl = '';
    }

    if (target === 'product') {
      this.productForm.imageUrl = '';
    }

    if (target === 'cocoon') {
      this.cocoonImageUrl = '';
    }

    this.imageError = '';
  }

  private validImage(value: string): boolean {
    if (!value) return true;

    if (
      value.startsWith('data:image/jpeg;base64,')
    ) {
      return (
        value.length <= this.maxBase64Length &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/
          .test(value)
      );
    }

    if (value.length > 2048) return false;

    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' ||
        url.protocol === 'http:'
      );
    } catch {
      return false;
    }
  }

  // =========================================
  // SUMMARY CARDS
  // =========================================

  get totalSilkworms(): number {
    return this.species.reduce(
      (total, item) => total + item.quantity,
      0
    );
  }

  get totalCocoons(): number {
    return (
      this.cocoons.good +
      this.cocoons.minor +
      this.cocoons.unusable
    );
  }

  get availableCocoons(): number {
    return Math.max(
      0,
      this.cocoons.good - this.cocoons.reserved
    );
  }

  get totalSilkProducts(): number {
    return this.products.reduce(
      (total, item) => total + item.quantity,
      0
    );
  }

  get lowStockCount(): number {
    return this.stockAlerts.length;
  }

  get stockAlerts(): StockAlert[] {
    const worms = this.species
      .filter(
        item => item.quantity <= item.threshold
      )
      .map(item => ({
        name: item.name,
        quantity: item.quantity,
        threshold: item.threshold,
        unit: 'worms'
      }));

    const productAlerts = this.products
      .filter(
        item => item.quantity <= item.threshold
      )
      .map(item => ({
        name: item.name,
        quantity: item.quantity,
        threshold: item.threshold,
        unit: item.unit
      }));

    return [...worms, ...productAlerts];
  }

  get cocoonQualityPercent(): number {
    return this.totalCocoons > 0
      ? Math.round(
          this.cocoons.good /
          this.totalCocoons * 100
        )
      : 0;
  }

  get cocoonChartStyle(): string {
    if (this.totalCocoons <= 0) {
      return 'conic-gradient(#e5ede4 0% 100%)';
    }

    const good =
      this.cocoons.good / this.totalCocoons * 100;

    const minor =
      this.cocoons.minor / this.totalCocoons * 100;

    return `conic-gradient(
      #28785b 0% ${good}%,
      #cbdcca ${good}% ${good + minor}%,
      #f2b9b6 ${good + minor}% 100%
    )`;
  }

  // =========================================
  // SEARCH AND FILTERS
  // =========================================

  get filteredSpecies(): Species[] {
    const search = this.searchSpecies
      .trim()
      .toLowerCase();

    return this.species.filter(
      item => [
        item.name,
        item.scientificName,
        item.stage,
        item.condition
      ]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }

  get productCategoryOptions(): string[] {
    return [
      ...new Set([
        ...this.productCategories,
        ...this.products.map(
          item => item.category
        )
      ])
    ];
  }

  get filteredProducts(): SilkProduct[] {
    const search = this.searchProducts
      .trim()
      .toLowerCase();

    return this.products.filter(item => {
      const matchesSearch = [
        item.name,
        item.category,
        item.description
      ]
        .join(' ')
        .toLowerCase()
        .includes(search);

      const matchesCategory =
        this.productFilter === 'All' ||
        item.category === this.productFilter;

      return (
        matchesSearch &&
        matchesCategory
      );
    });
  }

  getStockLabel(
    quantity: number,
    threshold: number
  ): string {
    if (quantity <= 0) {
      return 'Out of Stock';
    }

    return quantity <= threshold
      ? 'Low Stock'
      : 'In Stock';
  }

  getStockClass(
    quantity: number,
    threshold: number
  ): string {
    if (quantity <= 0) {
      return 'stock-empty';
    }

    return quantity <= threshold
      ? 'stock-low'
      : 'stock-good';
  }

  // =========================================
  // INVENTORY ACTIVITY
  // =========================================

  openAllActivity(): void {
    this.showAllActivity = true;
  }

  closeAllActivity(): void {
    this.showAllActivity = false;
  }

  get allActivities(): Activity[] {
    return [...this.activities].sort(
      (a, b) =>
        this.toMillis(b.createdAt) -
        this.toMillis(a.createdAt)
    );
  }

  get recentActivities(): Activity[] {
    return this.allActivities.slice(0, 2);
  }

  private addBatchActivity(
    batch: ReturnType<typeof writeBatch>,
    message: string,
    detail: string,
    type: ActivityType
  ): void {
    const reference = doc(
      collection(
        this.firestore,
        'inventory_activity'
      )
    );

    batch.set(reference, {
      message,
      detail,
      type,
      actorUid: this.currentUserId,
      createdAt: serverTimestamp()
    });
  }

  private addTransactionActivity(
    transaction: any,
    reference: any,
    message: string,
    detail: string,
    type: ActivityType
  ): void {
    transaction.set(reference, {
      message,
      detail,
      type,
      actorUid: this.currentUserId,
      createdAt: serverTimestamp()
    });
  }

  // =========================================
  // NEW: ADD SILKWORM TO PRODUCT MANAGEMENT
  // =========================================

  isSpeciesInProducts(item: Species): boolean {
    return this.products.some(product =>
      product.category === 'Silkworms' &&
      product.name.trim().toLowerCase() ===
        item.name.trim().toLowerCase()
    );
  }

  async addSpeciesToProducts(
    item: Species
  ): Promise<void> {

    if (this.saving) return;

    if (!this.currentUserId) {
      await this.warning(
        'Please sign in with an Admin or Staff account.'
      );
      return;
    }

    if (item.quantity <= 0) {
      await this.warning(
        'This species has no available inventory.'
      );
      return;
    }

    if (this.isSpeciesInProducts(item)) {
      await Swal.fire({
        icon: 'info',
        title: 'Already Listed',
        text:
          `${item.name} already exists in Product Management. ` +
          'You can edit its selling price and stock there.',
        confirmButtonColor: '#287457'
      });
      return;
    }

    const maximum = item.quantity;

    const result = await Swal.fire({
      title: 'Add Silkworm to Products',
      html: `
        <div class="silkworm-selling-form">
          <p class="silkworm-selling-name">
            ${this.escapeHtml(item.name)}
          </p>

          <p class="silkworm-selling-available">
            Inventory: ${maximum.toLocaleString('en-PH')} worms
          </p>

          <label for="silkwormSellingPrice">
            Selling Price per Worm (₱)
          </label>

          <input
            id="silkwormSellingPrice"
            class="swal2-input"
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter selling price"
          >

          <label for="silkwormSellingQuantity">
            Quantity to List for Sale
          </label>

          <input
            id="silkwormSellingQuantity"
            class="swal2-input"
            type="number"
            min="1"
            max="${maximum}"
            step="1"
            placeholder="Enter number of worms"
          >

          <p class="silkworm-selling-note">
            The new listing will be saved as a Draft.
            Your existing species inventory will not be deducted.
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Add to Products',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#287457',
      reverseButtons: true,
      focusConfirm: false,

      preConfirm: () => {
        const priceInput =
          document.getElementById(
            'silkwormSellingPrice'
          ) as HTMLInputElement | null;

        const quantityInput =
          document.getElementById(
            'silkwormSellingQuantity'
          ) as HTMLInputElement | null;

        const priceText =
          priceInput?.value.trim() || '';

        const quantityText =
          quantityInput?.value.trim() || '';

        const price = Number(priceText);
        const quantity = Number(quantityText);

        if (
          !priceText ||
          !quantityText ||
          !Number.isFinite(price) ||
          price < 0 ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > maximum
        ) {
          Swal.showValidationMessage(
            `Enter a valid price and a quantity ` +
            `between 1 and ${maximum.toLocaleString('en-PH')}.`
          );

          return false;
        }

        return {
          price,
          quantity
        };
      }
    });

    if (!result.isConfirmed || !result.value) {
      return;
    }

    const price = Number(result.value.price);
    const quantity = Number(result.value.quantity);

    this.saving = true;
    this.refresh();

    try {
      await this.inContext(async () => {
        const productRef = doc(
          collection(this.firestore, 'products')
        );

        const batch = writeBatch(this.firestore);

        const description =
          item.scientificName.trim() ||
          `${item.name} silkworms`;

        batch.set(productRef, {
          id: productRef.id,
          name: item.name.trim(),
          category: 'Silkworms',
          description,
          price,
          stock: quantity,
          imageUrl: item.imageUrl,
          published: false,
          featured: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        this.addBatchActivity(
          batch,
          'Silkworm added to Product Management',
          `${item.name} — ${quantity} worms at ₱${price.toFixed(2)} each`,
          'add'
        );

        await batch.commit();
      });

      const confirmation = await Swal.fire({
        icon: 'success',
        title: 'Added to Product Management',
        text:
          `${item.name} has been added as a draft listing. ` +
          'You can publish it in Product Management.',
        showCancelButton: true,
        confirmButtonText: 'Open Product Management',
        cancelButtonText: 'Stay in Inventory',
        confirmButtonColor: '#287457',
        reverseButtons: true
      });

      if (confirmation.isConfirmed) {
        this.goToProductManagement();
      }

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // ADD / EDIT SPECIES
  // =========================================

  openAddSpecies(): void {
    this.editorKind = 'species';
    this.editingId = null;
    this.speciesForm = this.emptySpecies();
    this.imageError = '';
    this.showEditor = true;
  }

  openEditSpecies(item: Species): void {
    this.editorKind = 'species';
    this.editingId = item.id;
    this.speciesForm = { ...item };
    this.imageError = '';
    this.showEditor = true;
  }

  // =========================================
  // ADD / EDIT PRODUCTS
  // =========================================

  openAddProduct(): void {
    this.editorKind = 'product';
    this.editingId = null;
    this.productForm = this.emptyProduct();
    this.imageError = '';
    this.showEditor = true;
  }

  
  openEditProduct(item: SilkProduct): void {
    this.editorKind = 'product';
    this.editingId = item.id;

    this.productForm = {
      ...item,
      colorStocks: (item.colorStocks || []).map(
        color => ({ ...color })
      )
    };

    this.imageError = '';
    this.showEditor = true;
  }

  closeEditor(): void {
    if (this.saving || this.processingImage) return;

    this.showEditor = false;
    this.editingId = null;
    this.imageError = '';
  }

  async saveEditor(): Promise<void> {
    if (
      !this.currentUserId ||
      this.saving ||
      this.processingImage
    ) {
      return;
    }

    if (this.editorKind === 'species') {
      await this.saveSpecies();
    } else {
      await this.saveProduct();
    }
  }

  private async saveSpecies(): Promise<void> {
    const form = this.speciesForm;
    const quantity = Number(form.quantity);
    const threshold = Number(form.threshold);

    if (
      !form.name.trim() ||
      form.name.trim().length > 100 ||
      form.scientificName.length > 150 ||
      !this.stages.includes(form.stage) ||
      !this.conditions.includes(form.condition) ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      !Number.isInteger(threshold) ||
      threshold < 0 ||
      !this.validImage(form.imageUrl)
    ) {
      await this.warning(
        'Check the silkworm information.'
      );
      return;
    }

    const editing = !!this.editingId;

    this.saving = true;
    this.refresh();

    try {
      await this.inContext(async () => {
        const reference = editing
          ? doc(
              this.firestore,
              'inventory_species',
              this.editingId!
            )
          : doc(
              collection(
                this.firestore,
                'inventory_species'
              )
            );

        const data = {
          name: form.name.trim(),
          scientificName: form.scientificName.trim(),
          stage: form.stage,
          condition: form.condition,
          quantity,
          threshold,
          imageUrl: form.imageUrl,
          updatedAt: serverTimestamp(),
          updatedBy: this.currentUserId
        };

        const batch = writeBatch(this.firestore);

        if (editing) {
          batch.update(reference, data);
        } else {
          batch.set(reference, {
            ...data,
            id: reference.id,
            createdAt: serverTimestamp()
          });
        }

        this.addBatchActivity(
          batch,
          editing
            ? 'Silkworm species updated'
            : 'Silkworm species added',
          `${data.name} — ${quantity} worms`,
          editing ? 'edit' : 'add'
        );

        await batch.commit();
      });

      this.showEditor = false;
      this.editingId = null;

      await this.success(
        editing
          ? 'Species Updated'
          : 'Species Added'
      );

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  
  private async saveProduct(): Promise<void> {
    const form = this.productForm;
    const price = Number(form.price);

    const supportsColors = this.canManageProductColors();

    const colorStocks: ProductColorStock[] =
      supportsColors
        ? form.colorStocks.map(color => ({
            name: color.name,
            quantity: Number(color.quantity)
          }))
        : [];

    if (colorStocks.length > 0) {
      const invalidColors = colorStocks.some(color =>
        !this.availableProductColors.some(
          available => available.name === color.name
        ) ||
        !Number.isInteger(color.quantity) ||
        color.quantity <= 0
      );

      if (invalidColors) {
        await this.warning(
          'Every selected color must have a quantity greater than zero, using whole numbers only.'
        );
        return;
      }
    }

    const stock = colorStocks.length > 0
      ? colorStocks.reduce(
          (total, color) => total + color.quantity,
          0
        )
      : Number(form.quantity);

    if (
      !form.name.trim() ||
      form.name.trim().length > 120 ||
      form.description.length > 2000 ||
      !this.productCategories.includes(form.category) ||
      !Number.isInteger(stock) ||
      stock < 0 ||
      !Number.isFinite(price) ||
      price < 0 ||
      !this.validImage(form.imageUrl)
    ) {
      await this.warning(
        'Check the product information.'
      );
      return;
    }

    if (form.published && stock <= 0) {
      await this.warning(
        'Add stock before publishing.'
      );
      return;
    }

    const editing = !!this.editingId;

    this.saving = true;
    this.refresh();

    try {
      await this.inContext(async () => {
        const reference = editing
          ? doc(
              this.firestore,
              'products',
              this.editingId!
            )
          : doc(
              collection(this.firestore, 'products')
            );

        const data = {
          name: form.name.trim(),
          category: form.category,
          description: form.description.trim(),
          price,
          stock,
          colorStocks,
          imageUrl: form.imageUrl,
          published: form.published,
          featured: form.featured,
          updatedAt: serverTimestamp()
        };

        const batch = writeBatch(this.firestore);

        if (editing) {
          batch.update(reference, data);
        } else {
          batch.set(reference, {
            ...data,
            id: reference.id,
            createdAt: serverTimestamp()
          });
        }

        const unit =
          form.category === 'Silkworms'
            ? 'worms'
            : form.category === 'Cocoons'
              ? 'cocoons'
              : 'pcs';

        const colorSummary = colorStocks.length > 0
          ? ' | Colors: ' +
            colorStocks.map(
              color => `${color.name}: ${color.quantity}`
            ).join(', ')
          : '';

        this.addBatchActivity(
          batch,
          editing
            ? 'Silk product updated'
            : 'Silk product added',
          `${data.name} — ${stock} ${unit}${colorSummary}`,
          editing ? 'edit' : 'add'
        );

        await batch.commit();
      });

      this.showEditor = false;
      this.editingId = null;

      await this.success(
        editing ? 'Product Updated' : 'Product Added'
      );

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }


  // =========================================
  // STOCK ADJUSTMENTS
  // =========================================

  private async askAdjustment(
    name: string,
    quantity: number
  ): Promise<number | null> {
    const result = await Swal.fire({
      title: 'Adjust Stock',
      text:
        `${name} — Current stock: ${quantity}. ` +
        'Positive adds, negative deducts.',
      input: 'number',
      inputValue: '0',
      inputAttributes: {
        step: '1'
      },
      showCancelButton: true,
      confirmButtonText: 'Update Stock',
      confirmButtonColor: '#287457',

      preConfirm: value => {
        const amount = Number(value);

        if (
          !String(value).trim() ||
          !Number.isInteger(amount) ||
          amount === 0
        ) {
          Swal.showValidationMessage(
            'Enter a non-zero whole number.'
          );
          return false;
        }

        return amount;
      }
    });

    return result.isConfirmed
      ? Number(result.value)
      : null;
  }

  async adjustSpecies(item: Species): Promise<void> {
    if (this.saving) return;

    const change = await this.askAdjustment(
      item.name,
      item.quantity
    );

    if (change === null) return;

    this.saving = true;

    try {
      await this.inContext(async () => {
        const reference = doc(
          this.firestore,
          'inventory_species',
          item.id
        );

        const activityReference = doc(
          collection(
            this.firestore,
            'inventory_activity'
          )
        );

        await runTransaction(
          this.firestore,
          async transaction => {
            const snapshot =
              await transaction.get(reference);

            if (!snapshot.exists()) {
              throw new Error(
                'Species no longer exists.'
              );
            }

            const current = Number(
              snapshot.data()['quantity'] || 0
            );

            const next = current + change;

            if (next < 0) {
              throw new Error(
                'Insufficient silkworm stock.'
              );
            }

            transaction.update(reference, {
              quantity: next,
              updatedAt: serverTimestamp(),
              updatedBy: this.currentUserId
            });

            this.addTransactionActivity(
              transaction,
              activityReference,
              'Silkworm stock adjusted',
              `${item.name}: ${
                change > 0 ? '+' : ''
              }${change} worms`,
              'stock'
            );
          }
        );
      });

      await this.success('Stock Updated');

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  
  async adjustProduct(item: SilkProduct): Promise<void> {
    if (this.saving) return;

    if (item.colorStocks && item.colorStocks.length > 0) {
      await this.warning(
        'This product has color-specific stock. Use Edit to update the quantity of each color.'
      );
      return;
    }

    const change = await this.askAdjustment(
      item.name,
      item.quantity
    );

    if (change === null) return;

    this.saving = true;

    try {
      await this.inContext(async () => {
        const reference = doc(
          this.firestore,
          'products',
          item.id
        );

        const activityReference = doc(
          collection(
            this.firestore,
            'inventory_activity'
          )
        );

        await runTransaction(
          this.firestore,
          async transaction => {
            const snapshot =
              await transaction.get(reference);

            if (!snapshot.exists()) {
              throw new Error(
                'Product no longer exists.'
              );
            }

            
            const existingColorStocks =
              snapshot.data()['colorStocks'];

            if (
              Array.isArray(existingColorStocks) &&
              existingColorStocks.length > 0
            ) {
              throw new Error(
                'This product uses color-specific stock. Update individual color quantities using Edit.'
              );
            }

            const current = Number(
              snapshot.data()['stock'] || 0
            );

            const next = current + change;

            if (next < 0) {
              throw new Error(
                'Insufficient product stock.'
              );
            }

            transaction.update(reference, {
              stock: next,
              published:
                next > 0 &&
                snapshot.data()['published'] === true,
              updatedAt: serverTimestamp()
            });

            this.addTransactionActivity(
              transaction,
              activityReference,
              'Product stock adjusted',
              `${item.name}: ${
                change > 0 ? '+' : ''
              }${change} ${item.unit}`,
              'stock'
            );
          }
        );
      });

      await this.success('Product Stock Updated');

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // DELETE RECORDS
  // =========================================

  private async confirmDelete(
    name: string
  ): Promise<boolean> {
    const result = await Swal.fire({
      icon: 'warning',
      title: 'Delete Inventory Record?',
      text:
        `Permanently delete "${name}"?`,
      showCancelButton: true,
      confirmButtonText: 'Delete',
      confirmButtonColor: '#be4d4d',
      reverseButtons: true
    });

    return result.isConfirmed;
  }

  async deleteSpecies(item: Species): Promise<void> {
    if (this.saving) return;

    if (
      !await this.confirmDelete(item.name)
    ) {
      return;
    }

    this.saving = true;

    try {
      await this.inContext(async () => {
        const batch = writeBatch(this.firestore);

        batch.delete(
          doc(
            this.firestore,
            'inventory_species',
            item.id
          )
        );

        this.addBatchActivity(
          batch,
          'Silkworm species deleted',
          item.name,
          'remove'
        );

        await batch.commit();
      });

      await this.success('Species Deleted');

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  async deleteProduct(
    item: SilkProduct
  ): Promise<void> {
    if (this.saving) return;

    if (
      !await this.confirmDelete(item.name)
    ) {
      return;
    }

    this.saving = true;

    try {
      await this.inContext(async () => {
        const batch = writeBatch(this.firestore);

        batch.delete(
          doc(
            this.firestore,
            'products',
            item.id
          )
        );

        this.addBatchActivity(
          batch,
          'Silk product deleted',
          item.name,
          'remove'
        );

        await batch.commit();
      });

      await this.success('Product Deleted');

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // COCOON INVENTORY
  // =========================================

  openCocoonEditor(): void {
    this.cocoonGoodChange = 0;
    this.cocoonMinorChange = 0;
    this.cocoonUnusableChange = 0;
    this.cocoonImageUrl = this.cocoons.imageUrl;
    this.imageError = '';
    this.showCocoonEditor = true;
  }

  closeCocoonEditor(): void {
    if (this.saving || this.processingImage) return;

    this.showCocoonEditor = false;
    this.imageError = '';
  }

  adjustCocoons(): void {
    this.openCocoonEditor();
  }

  async saveCocoonChanges(): Promise<void> {
    if (
      this.saving ||
      this.processingImage
    ) {
      return;
    }

    const goodChange =
      Number(this.cocoonGoodChange);

    const minorChange =
      Number(this.cocoonMinorChange);

    const unusableChange =
      Number(this.cocoonUnusableChange);

    if (
      ![
        goodChange,
        minorChange,
        unusableChange
      ].every(Number.isInteger) ||
      !this.validImage(this.cocoonImageUrl)
    ) {
      await this.warning(
        'Enter whole numbers and a valid image.'
      );
      return;
    }

    this.saving = true;
    this.refresh();

    try {
      await this.inContext(async () => {
        const reference = doc(
          this.firestore,
          'inventory',
          'cocoons'
        );

        const activityReference = doc(
          collection(
            this.firestore,
            'inventory_activity'
          )
        );

        const imageUrl = this.cocoonImageUrl;

        await runTransaction(
          this.firestore,
          async transaction => {
            const snapshot =
              await transaction.get(reference);

            const current: Cocoons =
              snapshot.exists()
                ? {
                    good: Number(
                      snapshot.data()['good'] || 0
                    ),
                    minor: Number(
                      snapshot.data()['minor'] || 0
                    ),
                    unusable: Number(
                      snapshot.data()['unusable'] || 0
                    ),
                    reserved: Number(
                      snapshot.data()['reserved'] || 0
                    ),
                    imageUrl: String(
                      snapshot.data()['imageUrl'] || ''
                    )
                  }
                : this.emptyCocoons();

            const next: Cocoons = {
              good: current.good + goodChange,
              minor: current.minor + minorChange,
              unusable:
                current.unusable + unusableChange,
              reserved: current.reserved,
              imageUrl
            };

            if (
              next.good < 0 ||
              next.minor < 0 ||
              next.unusable < 0
            ) {
              throw new Error(
                'Cocoon quantities cannot be negative.'
              );
            }

            if (
              next.reserved > next.good
            ) {
              throw new Error(
                'Reserved cocoons cannot exceed good-quality cocoons.'
              );
            }

            const updatedData = {
              ...next,
              updatedAt: serverTimestamp(),
              updatedBy: this.currentUserId
            };

            if (snapshot.exists()) {
              transaction.update(
                reference,
                updatedData
              );
            } else {
              transaction.set(reference, {
                ...updatedData,
                createdAt: serverTimestamp()
              });
            }

            this.addTransactionActivity(
              transaction,
              activityReference,
              'Cocoon inventory updated',
              `Good: ${
                goodChange >= 0 ? '+' : ''
              }${goodChange}, Minor: ${
                minorChange >= 0 ? '+' : ''
              }${minorChange}, Not usable: ${
                unusableChange >= 0 ? '+' : ''
              }${unusableChange}`,
              'cocoon'
            );
          }
        );
      });

      this.showCocoonEditor = false;

      await this.success(
        'Cocoon Inventory Saved'
      );

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  async updateReservations(): Promise<void> {
    if (this.saving) return;

    const result = await Swal.fire({
      icon: 'question',
      title: 'Manage Reserved Cocoons',
      text:
        `Good: ${this.cocoons.good}. ` +
        `Reserved: ${this.cocoons.reserved}.`,
      input: 'number',
      inputValue: String(
        this.cocoons.reserved
      ),
      inputAttributes: {
        min: '0',
        step: '1'
      },
      showCancelButton: true,
      confirmButtonText: 'Save Reservation',
      confirmButtonColor: '#287457',

      preConfirm: value => {
        const number = Number(value);

        if (
          !String(value).trim() ||
          !Number.isInteger(number) ||
          number < 0
        ) {
          Swal.showValidationMessage(
            'Enter a non-negative whole number.'
          );
          return false;
        }

        return number;
      }
    });

    if (!result.isConfirmed) return;

    const reserved = Number(result.value);
    this.saving = true;

    try {
      await this.inContext(async () => {
        const reference = doc(
          this.firestore,
          'inventory',
          'cocoons'
        );

        const activityReference = doc(
          collection(
            this.firestore,
            'inventory_activity'
          )
        );

        await runTransaction(
          this.firestore,
          async transaction => {
            const snapshot =
              await transaction.get(reference);

            const current: Cocoons =
              snapshot.exists()
                ? {
                    good: Number(
                      snapshot.data()['good'] || 0
                    ),
                    minor: Number(
                      snapshot.data()['minor'] || 0
                    ),
                    unusable: Number(
                      snapshot.data()['unusable'] || 0
                    ),
                    reserved: Number(
                      snapshot.data()['reserved'] || 0
                    ),
                    imageUrl: String(
                      snapshot.data()['imageUrl'] || ''
                    )
                  }
                : this.emptyCocoons();

            if (
              reserved > current.good
            ) {
              throw new Error(
                'Reservations exceed good cocoon stock.'
              );
            }

            const data = {
              ...current,
              reserved,
              updatedAt: serverTimestamp(),
              updatedBy: this.currentUserId
            };

            if (snapshot.exists()) {
              transaction.update(reference, data);
            } else {
              transaction.set(reference, {
                ...data,
                createdAt: serverTimestamp()
              });
            }

            this.addTransactionActivity(
              transaction,
              activityReference,
              'Cocoon reservations updated',
              `${current.reserved} → ${reserved} reserved`,
              'cocoon'
            );
          }
        );
      });

      await this.success(
        'Reservations Updated'
      );

    } catch (error: any) {
      await this.firebaseError(error);

    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // STOCK ALERTS
  // =========================================

  async showAlerts(): Promise<void> {
    if (!this.stockAlerts.length) {
      await Swal.fire({
        icon: 'success',
        title: 'No Stock Alerts',
        text:
          'There are no low-stock records.',
        confirmButtonColor: '#287457'
      });
      return;
    }

    const rows = this.stockAlerts.map(
      item => `
        <div style="
          padding:9px;
          text-align:left;
          border-bottom:1px solid #e5ebe4
        ">
          <strong>
            ${this.escapeHtml(item.name)}
          </strong>

          <p style="font-size:12px">
            ${item.quantity}
            ${this.escapeHtml(item.unit)}
            remaining.
            Threshold: ${item.threshold}
          </p>
        </div>
      `
    ).join('');

    await Swal.fire({
      icon: 'warning',
      title: 'Low Stock Alerts',
      html: rows,
      confirmButtonColor: '#287457'
    });
  }

  goToProductManagement(): void {
    this.router.navigate([
      '/home-adm/products'
    ]);
  }

  // =========================================
  // PRODUCTION LINE GRAPH
  // =========================================

  openProductionStatistics(): void {
    this.productionPeriod = 'daily';
    this.showProductionStatistics = true;
  }

  closeProductionStatistics(): void {
    this.showProductionStatistics = false;
  }

  setProductionPeriod(
    period: ProductionPeriod
  ): void {
    this.productionPeriod = period;
  }

  private productionDate(
    value: any
  ): Date | null {
    if (!value) return null;

    if (
      typeof value.toDate === 'function'
    ) {
      return value.toDate();
    }

    if (
      typeof value.seconds === 'number'
    ) {
      return new Date(
        value.seconds * 1000
      );
    }

    const date = new Date(value);

    return Number.isFinite(date.getTime())
      ? date
      : null;
  }

  private signedAmount(
    value: string
  ): number {
    const number = Number(
      value.replace(/,/g, '')
    );

    return Number.isFinite(number)
      ? number
      : 0;
  }

  private getActivityProduction(
    activity: Activity
  ): ProductionTotals {
    const totals: ProductionTotals = {
      silkworms: 0,
      products: 0,
      cocoons: 0
    };

    const detail = activity.detail || '';
    const message =
      activity.message.toLowerCase();

    if (
      message === 'silkworm species added'
    ) {
      const match = detail.match(
        /—\s*([\d,]+)\s*worms/i
      );

      if (match) {
        totals.silkworms =
          this.signedAmount(match[1]);
      }
    }

    if (
      message === 'silkworm stock adjusted'
    ) {
      const match = detail.match(
        /:\s*([+-]?\d[\d,]*)\s*worms/i
      );

      if (match) {
        totals.silkworms =
          this.signedAmount(match[1]);
      }
    }

    if (
      message === 'silk product added'
    ) {
      const match = detail.match(
        /—\s*([\d,]+)\s*(?:pcs|worms|cocoons)/i
      );

      if (match) {
        totals.products =
          this.signedAmount(match[1]);
      }
    }

    if (
      message === 'product stock adjusted'
    ) {
      const match = detail.match(
        /:\s*([+-]?\d[\d,]*)\s*(?:pcs|worms|cocoons)/i
      );

      if (match) {
        totals.products =
          this.signedAmount(match[1]);
      }
    }

    if (
      message === 'cocoon inventory updated'
    ) {
      const good = detail.match(
        /Good:\s*([+-]?\d[\d,]*)/i
      );

      const minor = detail.match(
        /Minor:\s*([+-]?\d[\d,]*)/i
      );

      const unusable = detail.match(
        /Not usable:\s*([+-]?\d[\d,]*)/i
      );

      totals.cocoons =
        (good
          ? this.signedAmount(good[1])
          : 0) +
        (minor
          ? this.signedAmount(minor[1])
          : 0) +
        (unusable
          ? this.signedAmount(unusable[1])
          : 0);
    }

    return totals;
  }

  private sameGraphPeriod(
    date: Date,
    target: Date
  ): boolean {
    if (
      date.getFullYear() !==
        target.getFullYear() ||
      date.getMonth() !==
        target.getMonth()
    ) {
      return false;
    }

    return (
      this.productionPeriod === 'monthly' ||
      date.getDate() === target.getDate()
    );
  }

  private graphTotalsFor(
    target: Date
  ): ProductionTotals {
    const totals: ProductionTotals = {
      silkworms: 0,
      products: 0,
      cocoons: 0
    };

    for (
      const activity of this.activities
    ) {
      const date = this.productionDate(
        activity.createdAt
      );

      if (
        !date ||
        !this.sameGraphPeriod(
          date,
          target
        )
      ) {
        continue;
      }

      const amounts =
        this.getActivityProduction(
          activity
        );

      totals.silkworms += Math.max(
        0,
        amounts.silkworms
      );

      totals.products += Math.max(
        0,
        amounts.products
      );

      totals.cocoons += Math.max(
        0,
        amounts.cocoons
      );
    }

    return totals;
  }

  get graphData(): ProductionPoint[] {
    const today = new Date();

    const count =
      this.productionPeriod === 'daily'
        ? 7
        : 6;

    const results: ProductionPoint[] = [];

    for (
      let index = 0;
      index < count;
      index++
    ) {
      const target = new Date(today);

      if (
        this.productionPeriod === 'daily'
      ) {
        target.setDate(
          today.getDate() -
          (count - index - 1)
        );
      } else {
        target.setDate(1);
        target.setMonth(
          today.getMonth() -
          (count - index - 1)
        );
      }

      const totals =
        this.graphTotalsFor(target);

      const label =
        this.productionPeriod === 'daily'
          ? target.toLocaleDateString(
              'en-PH',
              {
                month: 'short',
                day: 'numeric'
              }
            )
          : target.toLocaleDateString(
              'en-PH',
              {
                month: 'short',
                year: '2-digit'
              }
            );

      results.push({
        ...totals,
        date: target,
        label,
        x:
          this.graphLeft +
          index *
            (
              this.graphRight -
              this.graphLeft
            ) /
            (count - 1)
      });
    }

    return results;
  }

  get graphMaximum(): number {
    const values = this.graphData.flatMap(
      point => [
        point.silkworms,
        point.products,
        point.cocoons
      ]
    );

    const maximum = Math.max(
      0,
      ...values
    );

    if (maximum <= 0) return 4;

    const magnitude = Math.pow(
      10,
      Math.floor(
        Math.log10(maximum)
      )
    );

    const step = magnitude / 2;

    return Math.ceil(
      maximum / step
    ) * step;
  }

  graphY(value: number): number {
    const safeValue = Math.max(
      0,
      value
    );

    return (
      this.graphBottom -
      safeValue /
        this.graphMaximum *
        (
          this.graphBottom -
          this.graphTop
        )
    );
  }

  get graphTicks(): {
    value: number;
    y: number;
  }[] {
    return Array.from(
      { length: 5 },
      (_, index) => {
        const value =
          this.graphMaximum *
          index / 4;

        return {
          value,
          y: this.graphY(value)
        };
      }
    );
  }

  formatGraphNumber(
    value: number
  ): string {
    if (value >= 1000000) {
      return (
        (value / 1000000)
          .toFixed(1)
          .replace(/\.0$/, '') +
        'M'
      );
    }

    if (value >= 1000) {
      return (
        (value / 1000)
          .toFixed(1)
          .replace(/\.0$/, '') +
        'k'
      );
    }

    return Math.round(value)
      .toLocaleString('en-PH');
  }

  get graphSeries(): ProductionSeries[] {
    const data = this.graphData;

    return this.productionLines.map(
      line => ({
        ...line,
        total: data.reduce(
          (sum, point) =>
            sum + point[line.key],
          0
        ),
        points: data.map(
          point =>
            `${point.x},${
              this.graphY(
                point[line.key]
              )
            }`
        ).join(' ')
      })
    );
  }

  get graphHasData(): boolean {
    return this.graphSeries.some(
      line => line.total > 0
    );
  }

  get productionPeriodLabel(): string {
    return this.productionPeriod === 'daily'
      ? 'Inventory additions recorded during the last 7 days'
      : 'Inventory additions recorded during the last 6 months';
  }

  get currentProductionTrend(): {
    key: ProductionKey;
    name: string;
    current: number;
    previous: number;
    direction: 'up' | 'down' | 'same';
  }[] {
    const data = this.graphData;

    const current =
      data[data.length - 1];

    const previous =
      data[data.length - 2];

    return this.productionLines.map(
      line => {
        const currentValue =
          current?.[line.key] || 0;

        const previousValue =
          previous?.[line.key] || 0;

        return {
          key: line.key,
          name: line.name,
          current: currentValue,
          previous: previousValue,
          direction:
            currentValue > previousValue
              ? 'up'
              : currentValue < previousValue
                ? 'down'
                : 'same'
        };
      }
    );
  }

  // =========================================
  // GENERAL HELPERS
  // =========================================

  private toMillis(
    value: any
  ): number {
    if (!value) return 0;

    if (
      typeof value.toMillis === 'function'
    ) {
      return value.toMillis();
    }

    if (
      typeof value.seconds === 'number'
    ) {
      return value.seconds * 1000;
    }

    const milliseconds =
      new Date(value).getTime();

    return Number.isFinite(milliseconds)
      ? milliseconds
      : 0;
  }

  formatDate(
    value: any
  ): string {
    const milliseconds =
      this.toMillis(value);

    if (!milliseconds) {
      return 'Just now';
    }

    return new Date(
      milliseconds
    ).toLocaleString(
      'en-PH',
      {
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    );
  }

  private escapeHtml(
    value: string
  ): string {
    const replacements: Record<
      string,
      string
    > = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };

    return value.replace(
      /[&<>"']/g,
      character =>
        replacements[character]
    );
  }

  private async success(
    title: string
  ): Promise<void> {
    await Swal.fire({
      icon: 'success',
      title,
      timer: 1500,
      showConfirmButton: false
    });
  }

  private async warning(
    text: string
  ): Promise<void> {
    await Swal.fire({
      icon: 'warning',
      title: 'Check Information',
      text,
      confirmButtonColor: '#287457'
    });
  }

  private async firebaseError(
    error: any
  ): Promise<void> {
    console.error(
      'Inventory Firebase error:',
      error
    );

    await Swal.fire({
      icon: 'error',
      title: 'Unable to Save',
      text:
        error?.code === 'permission-denied'
          ? 'Firebase denied the request. Check your Admin/Staff role and Firestore rules.'
          : error?.message ||
            'Could not save your changes.',
      confirmButtonColor: '#287457'
    });
  }
}
