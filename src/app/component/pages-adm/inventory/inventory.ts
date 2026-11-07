
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
  getDocs,
  getDocsFromServer,
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
  lowStockThreshold?: number;
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
  sourceSpeciesId?: string;
}

interface Cocoons {
  good: number;
  minor: number;
  unusable: number;
  reserved: number;
  imageUrl: string;
  lowStockThreshold: number;
}

interface ProductionTotals {
  silkworms: number;
  products: number;
  cocoons: number;
}

interface Activity {
  id: string;
  message: string;
  detail: string;
  type: ActivityType;
  actorUid: string;
  createdAt: any;
  productionDelta?: ProductionTotals;
}

interface StockAlert {
  name: string;
  quantity: number;
  threshold: number;
  unit: string;
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
  cocoonLowStockThreshold = 10;
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
  private originalSpecies: Species | null = null;
  private originalProduct: SilkProduct | null = null;
  private originalCocoons: Cocoons | null = null;

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

  // =========================================
  // INITIALIZATION
  // =========================================

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

  // =========================================
  // FIREBASE INVENTORY LISTENERS
  // =========================================

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
                Number.isInteger(Number(item.lowStockThreshold)) &&
                Number(item.lowStockThreshold) >= 0
                  ? Number(item.lowStockThreshold)
                  : category === 'Silkworms' ? 10 : 100,
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
                      quantity: Number(color.quantity),
                      lowStockThreshold:
                        Number.isInteger(Number(color.lowStockThreshold)) &&
                        color.lowStockThreshold != null &&
                        Number(color.lowStockThreshold) >= 0
                          ? Number(color.lowStockThreshold)
                          : 10
                    }))
                : [],
              sourceSpeciesId: String(item.sourceSpeciesId || '')
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
                imageUrl: String(record.imageUrl || ''),
                lowStockThreshold:
                  this.validWholeNumber(record.lowStockThreshold)
                    ? Number(record.lowStockThreshold)
                    : 10
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
            createdAt: item.createdAt,
            ...(item.productionDelta &&
            typeof item.productionDelta === 'object'
              ? {
                  productionDelta: {
                    silkworms: Number(item.productionDelta.silkworms || 0),
                    products: Number(item.productionDelta.products || 0),
                    cocoons: Number(item.productionDelta.cocoons || 0)
                  }
                }
              : {})
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

  // =========================================
  // EMPTY FORMS
  // =========================================

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
      colorStocks: [],
      sourceSpeciesId: ''
    };
  }

  private emptyCocoons(): Cocoons {
    return {
      good: 0,
      minor: 0,
      unusable: 0,
      reserved: 0,
      imageUrl: '',
      lowStockThreshold: 10
    };
  }

  private validWholeNumber(value: unknown): boolean {
    return (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) >= 0
    );
  }

  // =========================================
  // PRODUCT COLOR MANAGEMENT
  // =========================================

  canManageProductColors(): boolean {
    const category = this.productForm.category
      .trim()
      .toLowerCase();

    return (
      category !== 'silkworms' &&
      category !== 'cocoons'
    );
  }

  hasProductColorStock(): boolean {
    return (
      this.canManageProductColors() &&
      this.productForm.colorStocks.length > 0
    );
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
        quantity: 0,
        lowStockThreshold: 10
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

  setProductColorThreshold(
    name: string,
    value: number | string
  ): void {
    const color = this.productForm.colorStocks.find(
      item => item.name === name
    );

    if (!color) return;

    color.lowStockThreshold = Number(value);
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
    if (!this.canManageProductColors()) return;

    this.productForm.quantity =
      this.productColorStockTotal;
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
        /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)
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

  // Linked products refer to the same stock as the source species.
  private linkedProductForSpecies(item: Species): SilkProduct | undefined {
    return this.products.find(product =>
      product.category === 'Silkworms' &&
      product.sourceSpeciesId === item.id
    );
  }

  // Keep the real species count; use whichever low-stock threshold
  // is stricter without inventing a second stock allocation.
  private displayedSpecies(item: Species): Species {
    const linked = this.linkedProductForSpecies(item);
    if (!linked) return item;
    return {
      ...item,
      threshold: Math.max(item.threshold, linked.threshold)
    };
  }

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
    const worms: StockAlert[] = this.species
      .filter(item => {
        const linked = this.linkedProductForSpecies(item);
        const threshold = Math.max(
          item.threshold,
          linked?.threshold ?? item.threshold
        );
        return item.quantity <= threshold;
      })
      .map(item => ({
        name: item.name,
        quantity: item.quantity,
        threshold: Math.max(
          item.threshold,
          this.linkedProductForSpecies(item)?.threshold ?? item.threshold
        ),
        unit: 'worms'
      }));

    const productAlerts: StockAlert[] = this.products
      .filter(item => !(
        item.category === 'Silkworms' &&
        item.sourceSpeciesId &&
        this.species.some(species => species.id === item.sourceSpeciesId)
      ))
      .filter(item => item.quantity <= item.threshold)
      .map(item => ({
        name: item.name,
        quantity: item.quantity,
        threshold: item.threshold,
        unit: item.unit
      }));

    const colorAlerts: StockAlert[] = this.products.flatMap(product =>
      product.colorStocks
        .filter(color => color.quantity <= (color.lowStockThreshold ?? 10))
        .map(color => ({
          name: `${product.name} — ${color.name}`,
          quantity: color.quantity,
          threshold: color.lowStockThreshold ?? 10,
          unit: 'pcs'
        }))
    );

    const cocoonAlerts: StockAlert[] =
      this.availableCocoons <= this.cocoons.lowStockThreshold
        ? [{
            name: 'Available Cocoons',
            quantity: this.availableCocoons,
            threshold: this.cocoons.lowStockThreshold,
            unit: 'cocoons'
          }]
        : [];

    return [...worms, ...productAlerts, ...colorAlerts, ...cocoonAlerts];
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

    return this.species
      .filter(item => [
        item.name,
        item.scientificName,
        item.stage,
        item.condition
      ]
        .join(' ')
        .toLowerCase()
        .includes(search))
      .map(item => this.displayedSpecies(item));
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
    type: ActivityType,
    productionDelta?: ProductionTotals
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
      createdAt: serverTimestamp(),
      ...(productionDelta ? { productionDelta } : {})
    });
  }

  private addTransactionActivity(
    transaction: any,
    reference: any,
    message: string,
    detail: string,
    type: ActivityType,
    productionDelta?: ProductionTotals
  ): void {
    transaction.set(reference, {
      message,
      detail,
      type,
      actorUid: this.currentUserId,
      createdAt: serverTimestamp(),
      ...(productionDelta ? { productionDelta } : {})
    });
  }

  // =========================================
  // SILKWORM PRODUCT LINKING
  // =========================================

  private normalizedName(name: string): string {
    return name.trim().toLocaleLowerCase();
  }

  private async assertSpeciesListingAvailable(
    speciesId: string,
    speciesName: string,
    exceptProductId = ''
  ): Promise<void> {
    // Query all products, not only links; older records may lack
    // sourceSpeciesId. Never guess that an existing record is safe
    // to overwrite or delete.
    const records = await getDocs(collection(this.firestore, 'products'));
    for (const entry of records.docs) {
      if (entry.id === exceptProductId) continue;
      const data = entry.data();
      if (String(data['category'] || '') !== 'Silkworms') continue;
      const link = String(data['sourceSpeciesId'] || '').trim();
      const name = String(data['name'] || '');
      if (link === speciesId) {
        throw new Error(
          'This species already has a product listing. Edit that listing instead.'
        );
      }
      if (!link && this.normalizedName(name) === this.normalizedName(speciesName)) {
        throw new Error(
          'An older unlinked silkworm product has the same species name. ' +
          'Do not create a duplicate. Its species link must be migrated safely ' +
          'before stock can be shared; existing Firestore rules currently ' +
          'prevent changing that link.'
        );
      }
    }
  }

  isSpeciesInProducts(item: Species): boolean {
    return this.products.some(product =>
      product.category === 'Silkworms' &&
      (
        product.sourceSpeciesId === item.id ||
        (!product.sourceSpeciesId &&
          this.normalizedName(product.name) === this.normalizedName(item.name))
      )
    );
  }

  async addSpeciesToProducts(item: Species): Promise<void> {
    if (this.saving) return;
    if (!this.currentUserId) {
      await this.warning('Please sign in with an Admin or Staff account.');
      return;
    }
    if (this.isSpeciesInProducts(item)) {
      await this.warning(
        'This species already has a linked or potentially matching older ' +
        'product. Review that listing instead of creating a duplicate.'
      );
      return;
    }

    const result = await Swal.fire({
      title: 'Add Silkworm to Products',
      html: `
        <div class="silkworm-selling-form">
          <p class="silkworm-selling-name">${this.escapeHtml(item.name)}</p>
          <p class="silkworm-selling-available">
            Shared species stock: ${item.quantity.toLocaleString('en-PH')} worms
          </p>
          <label for="silkwormSellingPrice">Selling Price per Worm (₱)</label>
          <input id="silkwormSellingPrice" class="swal2-input"
            type="number" min="0" step="0.01"
            placeholder="Enter selling price">
          <p class="silkworm-selling-note">
            All existing species stock is listed; no separate allocation.
            The product is initially a Draft. Stock decreases only on delivery.
          </p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Add to Products',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#287457',
      reverseButtons: true,
      focusConfirm: false,
      preConfirm: () => {
        const input = document.getElementById(
          'silkwormSellingPrice'
        ) as HTMLInputElement | null;
        const value = input?.value.trim() || '';
        const price = Number(value);
        if (!value || !Number.isFinite(price) || price < 0) {
          Swal.showValidationMessage('Enter a valid non-negative selling price.');
          return false;
        }
        return { price };
      }
    });
    if (!result.isConfirmed || !result.value) return;
    const price = Number(result.value.price);

    this.saving = true;
    this.refresh();
    try {
      await this.inContext(async () => {
        await this.assertSpeciesListingAvailable(item.id, item.name);
        // Deterministic ID makes repeated Add to Products calls idempotent
        // for this entry point. Other creation entry points will be aligned
        // when products.ts is revised.
        const productRef = doc(this.firestore, 'products', item.id);
        const speciesRef = doc(this.firestore, 'inventory_species', item.id);
        const activityRef = doc(collection(this.firestore, 'inventory_activity'));
        await runTransaction(this.firestore, async transaction => {
          const speciesSnap = await transaction.get(speciesRef);
          const productSnap = await transaction.get(productRef);
          if (!speciesSnap.exists()) {
            throw new Error('Species record no longer exists.');
          }
          if (productSnap.exists()) {
            throw new Error('This product document ID is already in use.');
          }
          const species = speciesSnap.data();
          const quantity = Number(species['quantity']);
          if (!this.validWholeNumber(quantity) || quantity > 100000000) {
            throw new Error('Species has invalid stock.');
          }
          const speciesName = String(species['name'] || '').trim();
          if (!speciesName) throw new Error('Species name is missing.');
          if (speciesName !== item.name.trim()) {
            throw new Error('Species name changed. Refresh Inventory and retry.');
          }
          transaction.set(productRef, {
            id: productRef.id,
            name: speciesName,
            category: 'Silkworms',
            description: String(species['scientificName'] || '').trim() ||
              `${speciesName} silkworms`,
            price,
            stock: quantity,
            lowStockThreshold: Number(species['threshold'] ?? 10),
            sourceSpeciesId: item.id,
            colorStocks: [],
            imageUrl: String(species['imageUrl'] || ''),
            published: false,
            featured: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          this.addTransactionActivity(
            transaction, activityRef,
            'Silkworm added to Product Management',
            `${speciesName} — ${quantity} shared worms at ₱${price.toFixed(2)} each`,
            'add'
          );
        });
      });

      const confirmation = await Swal.fire({
        icon: 'success',
        title: 'Added to Product Management',
        text: `${item.name} has been added as a draft listing using the full species stock.`,
        showCancelButton: true,
        confirmButtonText: 'Open Product Management',
        cancelButtonText: 'Stay in Inventory',
        confirmButtonColor: '#287457',
        reverseButtons: true
      });
      if (confirmation.isConfirmed) this.goToProductManagement();
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
    this.originalSpecies = null;
    this.imageError = '';
    this.showEditor = true;
  }

  openEditSpecies(item: Species): void {
    // filteredSpecies contains a display-only stock-alert threshold.
    // Always edit the actual persisted species values, not the badge values.
    const actual = this.species.find(species => species.id === item.id);
    if (!actual) return;

    this.editorKind = 'species';
    this.editingId = actual.id;
    this.speciesForm = { ...actual };
    this.originalSpecies = { ...actual };
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
    this.originalProduct = null;
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

    this.originalProduct = {
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
    this.originalSpecies = null;
    this.originalProduct = null;
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

  private sameColorQuantities(
    a: ProductColorStock[],
    b: ProductColorStock[]
  ): boolean {
    if (a.length !== b.length) return false;

    const map = new Map(
      a.map(color => [
        color.name,
        Number(color.quantity)
      ])
    );

    return (
      map.size === a.length &&
      b.every(color =>
        map.has(color.name) &&
        map.get(color.name) === Number(color.quantity)
      )
    );
  }

  private mergeThresholds(
    original: ProductColorStock[],
    desired: ProductColorStock[],
    current: ProductColorStock[]
  ): ProductColorStock[] {
    const originalMap = new Map(
      original.map(color => [
        color.name,
        Number(color.lowStockThreshold ?? 10)
      ])
    );

    const desiredMap = new Map(
      desired.map(color => [
        color.name,
        Number(color.lowStockThreshold ?? 10)
      ])
    );

    return current.map(color => {
      const before =
        originalMap.get(color.name) ?? 10;

      const desiredValue =
        desiredMap.get(color.name) ?? before;

      const now =
        Number(color.lowStockThreshold ?? 10);

      if (
        desiredValue !== before &&
        now !== before &&
        now !== desiredValue
      ) {
        throw new Error(
          `Color threshold changed for ${color.name}. Reopen the product.`
        );
      }

      return {
        ...color,
        lowStockThreshold:
          desiredValue !== before
            ? desiredValue
            : now
      };
    });
  }

  // =========================================
  // SAVE SPECIES
  // =========================================

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
      await this.warning('Check the silkworm information.');
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
              collection(this.firestore, 'inventory_species')
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

        if (editing) {
          const original = this.originalSpecies;
          if (!original) throw new Error('Reopen the species before editing.');
          const linked = this.products.filter(product =>
            product.category === 'Silkworms' &&
            product.sourceSpeciesId === reference.id
          );
          if (linked.length > 1) {
            throw new Error('Several products share this species link. Resolve duplicates first.');
          }
          if (linked.length === 0 && this.products.some(product =>
            product.category === 'Silkworms' &&
            !product.sourceSpeciesId &&
            this.normalizedName(product.name) === this.normalizedName(original.name)
          )) {
            throw new Error('An older matching product is unlinked. Review its link first.');
          }
          const linkedRef = linked.length
            ? doc(this.firestore, 'products', linked[0].id)
            : null;
          const activityRef = doc(collection(this.firestore, 'inventory_activity'));
          await runTransaction(this.firestore, async transaction => {
            const snapshot = await transaction.get(reference);
            const productSnapshot = linkedRef ? await transaction.get(linkedRef) : null;
            if (!snapshot.exists()) throw new Error('Species no longer exists.');
            const currentStock = Number(snapshot.data()['quantity']);
            const userChangedStock = quantity !== original.quantity;
            if (!this.validWholeNumber(currentStock)) {
              throw new Error('Current species stock is invalid.');
            }
            if (userChangedStock && currentStock !== original.quantity) {
              throw new Error('Stock changed while editing. Reopen the species.');
            }
            if (linkedRef && (!productSnapshot || !productSnapshot.exists())) {
              throw new Error('Linked product is missing. Reopen Inventory.');
            }
            const currentProduct = productSnapshot?.data();
            if (currentProduct && (
              String(currentProduct['sourceSpeciesId'] || '') !== reference.id ||
              currentProduct['category'] !== 'Silkworms'
            )) {
              throw new Error('Linked product has changed. Reopen Inventory.');
            }
            if (currentProduct && userChangedStock) {
              const productStock = Number(currentProduct['stock']);
              if (!this.validWholeNumber(productStock) || productStock !== currentStock) {
                throw new Error(
                  'Existing species/product quantities differ. Use Stock Adjustment to ' +
                  'review and reconcile them before changing the quantity.'
                );
              }
            }
            transaction.update(reference, {
              ...data,
              quantity: userChangedStock ? quantity : currentStock
            });
            if (linkedRef && userChangedStock) {
              transaction.update(linkedRef, {
                stock: quantity,
                updatedAt: serverTimestamp()
              });
            }
            this.addTransactionActivity(
              transaction, activityRef,
              userChangedStock ? 'Silkworm stock adjusted' : 'Silkworm species updated',
              userChangedStock
                ? `${data.name}: ${currentStock} → ${quantity} worms (species + linked product)`
                : `${data.name} — ${currentStock} worms`,
              userChangedStock ? 'stock' : 'edit',
              userChangedStock ? {
                silkworms: Math.max(0, quantity - currentStock),
                products: 0,
                cocoons: 0
              } : undefined
            );
          });
        } else {
          const batch = writeBatch(this.firestore);

          batch.set(reference, {
            ...data,
            id: reference.id,
            createdAt: serverTimestamp()
          });

          this.addBatchActivity(
            batch,
            'Silkworm species added',
            `${data.name} — ${quantity} worms`,
            'add',
            {
              silkworms: quantity,
              products: 0,
              cocoons: 0
            }
          );

          await batch.commit();
        }
      });

      this.showEditor = false;
      this.editingId = null;

      await this.success(
        editing ? 'Species Updated' : 'Species Added'
      );
    } catch (error: any) {
      await this.firebaseError(error);
    } finally {
      this.saving = false;
      this.refresh();
    }
  }


  // =========================================
  // SAVE PRODUCT
  // =========================================

  private async saveProduct(): Promise<void> {
    const form = this.productForm;
    const price = Number(form.price);

    const supportsColors =
      this.canManageProductColors();

    const colorStocks: ProductColorStock[] =
      supportsColors
        ? form.colorStocks.map(color => ({
            name: color.name,
            quantity: Number(color.quantity),
            lowStockThreshold:
              Number(color.lowStockThreshold ?? 10)
          }))
        : [];

    if (colorStocks.length > 0) {
      const invalidColors = colorStocks.some(color =>
        !this.availableProductColors.some(
          available => available.name === color.name
        ) ||
        !Number.isInteger(color.quantity) ||
        color.quantity < 0 ||
        !Number.isInteger(Number(color.lowStockThreshold ?? 10)) ||
        Number(color.lowStockThreshold ?? 10) < 0
      );

      if (invalidColors) {
        await this.warning(
          'Color quantities and low-stock thresholds must be non-negative whole numbers.'
        );
        return;
      }
    }

    const threshold = Number(form.threshold);

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
      !Number.isInteger(threshold) ||
      threshold < 0 ||
      !Number.isFinite(price) ||
      price < 0 ||
      !this.validImage(form.imageUrl)
    ) {
      await this.warning('Check the product information.');
      return;
    }

    const editing = !!this.editingId;

    // The current inventory.html has no species dropdown. A small
    // selection dialog is used only when creating a silkworm listing.
    // An exact unique match is selected automatically; otherwise
    // staff explicitly choose which original species to list.
    let chosenSpecies: Species | null = null;
    if (!editing && form.category === 'Silkworms') {
      const unlisted = this.species.filter(species =>
        !this.isSpeciesInProducts(species)
      );
      if (!unlisted.length) {
        await this.warning(
          'No unlisted species is available. Add species in Inventory first, ' +
          'or edit its existing product listing.'
        );
        return;
      }
      const exact = unlisted.filter(species =>
        this.normalizedName(species.name) === this.normalizedName(form.name)
      );
      if (exact.length === 1) {
        chosenSpecies = exact[0];
      } else {
        const inputOptions: Record<string, string> = {};
        for (const species of unlisted) {
          inputOptions[species.id] =
            `${species.name} (${species.quantity.toLocaleString('en-PH')} worms)`;
        }
        const choice = await Swal.fire({
          icon: 'question',
          title: 'Choose Source Species',
          text: 'A silkworm product shares the complete stock of one species. No separate allocation is created.',
          input: 'select',
          inputOptions,
          inputPlaceholder: 'Select the original species',
          showCancelButton: true,
          confirmButtonText: 'Use This Species',
          confirmButtonColor: '#287457',
          inputValidator: value => value ? null : 'Select a species.'
        });
        if (!choice.isConfirmed || !choice.value) return;
        chosenSpecies = unlisted.find(species => species.id === choice.value) || null;
      }
      if (!chosenSpecies) {
        await this.warning('Select an existing silkworm species.');
        return;
      }
    }

    this.saving = true;
    this.refresh();

    try {
      await this.inContext(async () => {
        const reference = editing
          ? doc(this.firestore, 'products', this.editingId!)
          : chosenSpecies
            ? doc(this.firestore, 'products', chosenSpecies.id)
            : doc(collection(this.firestore, 'products'));

        const data = {
          name: form.name.trim(),
          category: form.category,
          description: form.description.trim(),
          price,
          stock,
          lowStockThreshold: threshold,
          colorStocks,
          imageUrl: form.imageUrl,
          published: form.published,
          featured: form.featured,
          updatedAt: serverTimestamp()
        };

        const unit =
          form.category === 'Silkworms'
            ? 'worms'
            : form.category === 'Cocoons'
              ? 'cocoons'
              : 'pcs';

        const activityRef = doc(
          collection(this.firestore, 'inventory_activity')
        );

        if (editing) {
          const original = this.originalProduct;

          if (!original) {
            throw new Error(
              'Reopen the product before editing.'
            );
          }

          await runTransaction(
            this.firestore,
            async transaction => {
              const snapshot =
                await transaction.get(reference);

              if (!snapshot.exists()) {
                throw new Error('Product no longer exists.');
              }

              const raw = snapshot.data();
              const currentSourceId = String(raw['sourceSpeciesId'] || '').trim();
              const speciesRef = currentSourceId
                ? doc(this.firestore, 'inventory_species', currentSourceId)
                : null;
              // All document reads precede transaction writes.
              const speciesSnapshot = speciesRef
                ? await transaction.get(speciesRef)
                : null;
              if (speciesRef && (!speciesSnapshot || !speciesSnapshot.exists())) {
                throw new Error('Linked species is missing. Reload Inventory.');
              }

              const currentStock =
                Number(raw['stock'] ?? 0);

              const currentColors: ProductColorStock[] =
                Array.isArray(raw['colorStocks'])
                  ? raw['colorStocks'].map((color: any) => ({
                      name: String(color.name),
                      quantity: Number(color.quantity),
                      lowStockThreshold:
                        Number(color.lowStockThreshold ?? 10)
                    }))
                  : [];

              const userChangedQuantity =
                stock !== original.quantity ||
                !this.sameColorQuantities(
                  colorStocks,
                  original.colorStocks
                );

              const remoteChangedQuantity =
                currentStock !== original.quantity ||
                !this.sameColorQuantities(
                  currentColors,
                  original.colorStocks
                );

              if (
                userChangedQuantity &&
                remoteChangedQuantity
              ) {
                throw new Error(
                  'Stock changed during editing. Reopen this product.'
                );
              }

              if (form.category === 'Silkworms' &&
                  !currentSourceId && raw['category'] !== 'Silkworms') {
                throw new Error(
                  'A regular product cannot be changed into an unlinked silkworm. ' +
                  'Create a silkworm listing from its original species instead.'
                );
              }
              if (currentSourceId && userChangedQuantity &&
                  this.products.filter(item =>
                    item.category === 'Silkworms' &&
                    item.sourceSpeciesId === currentSourceId
                  ).length > 1) {
                throw new Error('Several products share this species ID. Resolve duplicates first.');
              }

              if (
                currentSourceId &&
                userChangedQuantity
              ) {
                const speciesStock = Number(speciesSnapshot?.data()?.['quantity']);
                if (!this.validWholeNumber(speciesStock) ||
                    speciesStock !== currentStock) {
                  throw new Error(
                    'Linked species and product stock differ. Use Stock ' +
                    'Adjustment to review and reconcile before editing quantity.'
                  );
                }
                if (stock > 100000000) {
                  throw new Error('Shared stock exceeds the allowed limit.');
                }
              }
              if (!currentSourceId && raw['category'] === 'Silkworms' &&
                  userChangedQuantity) {
                throw new Error(
                  'This older silkworm listing has no sourceSpeciesId. ' +
                  'Its stock cannot be edited separately from the original species.'
                );
              }

              if (
                raw['sourceSpeciesId'] &&
                form.category !== 'Silkworms'
              ) {
                throw new Error(
                  'Linked species products must remain in Silkworms.'
                );
              }

              if (
                raw['everOrdered'] === true &&
                original.colorStocks.some(
                  color =>
                    !colorStocks.some(
                      updated => updated.name === color.name
                    )
                )
              ) {
                throw new Error(
                  'A previously ordered product cannot remove an existing color.'
                );
              }

              if (
                String(raw['sourceSpeciesId'] || '') !==
                String(original.sourceSpeciesId || '')
              ) {
                throw new Error(
                  'Product species link changed. Reopen it.'
                );
              }

              const thresholdsChanged =
                original.colorStocks.some(color =>
                  Number(color.lowStockThreshold ?? 10) !==
                  Number(
                    colorStocks.find(
                      desired => desired.name === color.name
                    )?.lowStockThreshold ?? 10
                  )
                );

              const fields: Record<string, unknown> = {
                name: data.name,
                category: data.category,
                description: data.description,
                price: data.price,
                lowStockThreshold: data.lowStockThreshold,
                imageUrl: data.imageUrl,
                published: data.published,
                featured: data.featured,
                updatedAt: serverTimestamp()
              };

              if (userChangedQuantity) {
                fields['stock'] = stock;
                fields['colorStocks'] = colorStocks;
              } else if (thresholdsChanged) {
                fields['colorStocks'] = this.mergeThresholds(
                  original.colorStocks,
                  colorStocks,
                  currentColors
                );
              }

              transaction.update(reference, fields);
              if (currentSourceId && userChangedQuantity) {
                transaction.update(speciesRef!, {
                  quantity: stock,
                  updatedAt: serverTimestamp(),
                  updatedBy: this.currentUserId
                });
              }

              this.addTransactionActivity(
                transaction,
                activityRef,
                'Silk product updated',
                `${data.name} — ${
                  userChangedQuantity ? stock : currentStock
                } ${unit}`,
                'edit',
                {
                  silkworms: currentSourceId && userChangedQuantity
                    ? Math.max(0, stock - currentStock)
                    : 0,
                  products: !currentSourceId && userChangedQuantity
                    ? Math.max(0, stock - currentStock)
                    : 0,
                  cocoons: 0
                }
              );
            }
          );
        } else if (chosenSpecies) {
          await this.assertSpeciesListingAvailable(
            chosenSpecies.id, chosenSpecies.name
          );
          const speciesRef = doc(
            this.firestore, 'inventory_species', chosenSpecies.id
          );
          await runTransaction(this.firestore, async transaction => {
            const speciesSnapshot = await transaction.get(speciesRef);
            const productSnapshot = await transaction.get(reference);
            if (!speciesSnapshot.exists()) {
              throw new Error('Selected species no longer exists.');
            }
            if (productSnapshot.exists()) {
              throw new Error('This species already has a product document.');
            }
            const rawSpecies = speciesSnapshot.data();
            const currentQuantity = Number(rawSpecies['quantity']);
            if (!this.validWholeNumber(currentQuantity) || currentQuantity > 100000000) {
              throw new Error('Original species stock is invalid.');
            }
            if (String(rawSpecies['name'] || '').trim() !== chosenSpecies.name) {
              throw new Error('Species changed. Reload Inventory and retry.');
            }
            transaction.set(reference, {
              ...data,
              id: reference.id,
              stock: currentQuantity,
              sourceSpeciesId: chosenSpecies.id,
              colorStocks: [],
              createdAt: serverTimestamp()
            });
            this.addTransactionActivity(
              transaction, activityRef, 'Silk product added',
              `${data.name} — ${currentQuantity} shared worms (${chosenSpecies.name})`,
              'add'
            );
          });
        } else {
          const batch = writeBatch(this.firestore);
          batch.set(reference, {
            ...data,
            id: reference.id,
            createdAt: serverTimestamp()
          });
          this.addBatchActivity(
            batch, 'Silk product added',
            `${data.name} — ${stock} ${unit}`,
            'add',
            { silkworms: 0, products: stock, cocoons: 0 }
          );
          await batch.commit();
        }
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

  // Reconciliation is explicit. We record both previous quantities and
  // update ONLY the linked product to the authoritative species count.
  // No orders are changed and no inventory delta is fabricated.
  private async reconcileLinkedSilkwormStock(
    product: SilkProduct,
    species: Species
  ): Promise<void> {
    const duplicates = this.products.filter(item =>
      item.category === 'Silkworms' &&
      item.sourceSpeciesId === species.id
    );
    if (duplicates.length > 1) {
      await this.warning(
        'More than one product points to this species. Review duplicate links before reconciliation.'
      );
      return;
    }
    const difference = species.quantity - product.quantity;
    if (difference === 0) return;

    const answer = await Swal.fire({
      icon: 'warning',
      title: 'Review Existing Stock Discrepancy',
      html: `
        <p><strong>${this.escapeHtml(species.name)}</strong></p>
        <p>Original species stock: <strong>${species.quantity.toLocaleString('en-PH')}</strong> worms</p>
        <p>Product stock: <strong>${product.quantity.toLocaleString('en-PH')}</strong> worms</p>
        <p>Difference: <strong>${Math.abs(difference).toLocaleString('en-PH')}</strong> worms</p>
        <p>This will make product stock equal to species stock, with an
        activity log recording both previous numbers. Historical and pending
        orders will not change. Review inventory history before confirming.</p>`,
      confirmButtonText: 'Reconcile Product to Species',
      cancelButtonText: 'Cancel',
      showCancelButton: true,
      confirmButtonColor: '#287457',
      reverseButtons: true
    });
    if (!answer.isConfirmed) return;

    this.saving = true;
    this.refresh();
    try {
      await this.inContext(async () => {
        const productRef = doc(this.firestore, 'products', product.id);
        const speciesRef = doc(this.firestore, 'inventory_species', species.id);
        const activityRef = doc(collection(this.firestore, 'inventory_activity'));
        await runTransaction(this.firestore, async transaction => {
          const productSnap = await transaction.get(productRef);
          const speciesSnap = await transaction.get(speciesRef);
          if (!productSnap.exists() || !speciesSnap.exists()) {
            throw new Error('Species or product no longer exists.');
          }
          const rawProduct = productSnap.data();
          const rawSpecies = speciesSnap.data();
          if (String(rawProduct['sourceSpeciesId'] || '') !== species.id ||
              rawProduct['category'] !== 'Silkworms') {
            throw new Error('Product species link changed. Reload Inventory.');
          }
          const productStock = Number(rawProduct['stock']);
          const speciesStock = Number(rawSpecies['quantity']);
          if (!this.validWholeNumber(productStock) ||
              !this.validWholeNumber(speciesStock)) {
            throw new Error('Invalid existing inventory quantities.');
          }
          if (productStock !== product.quantity ||
              speciesStock !== species.quantity) {
            throw new Error('Stock changed since confirmation. Reload and review again.');
          }
          transaction.update(productRef, {
            stock: speciesStock,
            updatedAt: serverTimestamp()
          });
          this.addTransactionActivity(
            transaction, activityRef, 'Silkworm stock reconciled',
            `${species.name}: product ${productStock} -> ${speciesStock}; ` +
            `original species ${speciesStock} unchanged; product ${product.id}`,
            'stock'
          );
        });
      });
      await this.success('Linked Stock Reconciled');
    } catch (error: any) {
      await this.firebaseError(error);
    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // Both records must change together. This helper is used whether staff
  // presses Stock in Species Inventory or the linked Products table.
  private async adjustLinkedSilkwormStock(
    product: SilkProduct,
    speciesId: string,
    change: number,
    name: string
  ): Promise<void> {
    await this.inContext(async () => {
      const productRef = doc(this.firestore, 'products', product.id);
      const speciesRef = doc(this.firestore, 'inventory_species', speciesId);
      const activityRef = doc(collection(this.firestore, 'inventory_activity'));

      await runTransaction(this.firestore, async transaction => {
        // Firestore requires all reads before the first write.
        const productSnapshot = await transaction.get(productRef);
        const speciesSnapshot = await transaction.get(speciesRef);

        if (!productSnapshot.exists() || !speciesSnapshot.exists()) {
          throw new Error('Linked silkworm product or species no longer exists.');
        }

        const productData = productSnapshot.data();
        const speciesData = speciesSnapshot.data();

        if (
          productData['category'] !== 'Silkworms' ||
          String(productData['sourceSpeciesId'] || '') !== speciesId
        ) {
          throw new Error('Silkworm product link changed. Reload inventory.');
        }

        if (
          Array.isArray(productData['colorStocks']) &&
          productData['colorStocks'].length > 0
        ) {
          throw new Error('Linked silkworms cannot have color-specific stock.');
        }

        const productStock = Number(productData['stock']);
        const speciesStock = Number(speciesData['quantity']);

        if (
          !this.validWholeNumber(productStock) ||
          !this.validWholeNumber(speciesStock)
        ) {
          throw new Error('The linked inventory has invalid stock values.');
        }

        if (productStock !== speciesStock) {
          throw new Error(
            'Linked quantities are different. Review and reconcile the ' +
            'product to species stock before adjusting inventory.'
          );
        }
        const nextSpecies = speciesStock + change;
        if (!Number.isSafeInteger(nextSpecies) || nextSpecies < 0 ||
            nextSpecies > 100000000) {
          throw new Error('Insufficient stock or an invalid adjustment amount.');
        }
        const nextProduct = nextSpecies;

        // One atomic transaction: either both records update, or neither does.
        transaction.update(productRef, {
          stock: nextProduct,
          updatedAt: serverTimestamp()
        });

        transaction.update(speciesRef, {
          quantity: nextSpecies,
          updatedAt: serverTimestamp(),
          updatedBy: this.currentUserId
        });

        this.addTransactionActivity(
          transaction,
          activityRef,
          'Silkworm stock adjusted',
          `${name}: ${change > 0 ? '+' : ''}${change} worms (linked inventory)`,
          'stock',
          {
            silkworms: Math.max(0, change),
            products: 0,
            cocoons: 0
          }
        );
      });
    });
  }

  async adjustSpecies(item: Species): Promise<void> {
    if (this.saving) return;

    const actual = this.species.find(species => species.id === item.id);
    if (!actual) {
      await this.warning('This species no longer exists. Reload inventory.');
      return;
    }

    const linkedProducts = this.products.filter(product =>
      product.category === 'Silkworms' &&
      product.sourceSpeciesId === item.id
    );

    if (linkedProducts.length > 1) {
      await this.warning(
        'Several products are linked to this species. Resolve duplicate links before changing stock.'
      );
      return;
    }

    const linkedProduct = linkedProducts[0];
    if (!linkedProduct) {
      const matchingUnlinked = this.products.some(product =>
        product.category === 'Silkworms' &&
        !product.sourceSpeciesId &&
        product.name.trim().toLowerCase() === item.name.trim().toLowerCase()
      );
      if (matchingUnlinked) {
        await this.warning(
          'A silkworm product has this species name but is not linked. ' +
          'Set its correct sourceSpeciesId in Firestore before adjusting stock.'
        );
        return;
      }
    }

    if (linkedProduct && linkedProduct.quantity !== actual.quantity) {
      await this.reconcileLinkedSilkwormStock(linkedProduct, actual);
      return;
    }

    const change = await this.askAdjustment(
      item.name,
      actual.quantity
    );

    if (change === null) return;
    this.saving = true;
    this.refresh();

    try {
      if (linkedProduct) {
        await this.adjustLinkedSilkwormStock(
          linkedProduct,
          item.id,
          change,
          item.name
        );
      } else {
        await this.inContext(async () => {
          const reference = doc(
            this.firestore,
            'inventory_species',
            item.id
          );
          const activityReference = doc(
            collection(this.firestore, 'inventory_activity')
          );

          await runTransaction(this.firestore, async transaction => {
            const snapshot = await transaction.get(reference);
            if (!snapshot.exists()) {
              throw new Error('Inventory record no longer exists.');
            }

            const current = Number(snapshot.data()['quantity']);
            const next = current + change;
            if (
              !this.validWholeNumber(current) ||
              !this.validWholeNumber(next) ||
              next > 100000000
            ) {
              throw new Error('Insufficient silkworm stock or invalid quantity.');
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
              `${item.name}: ${change > 0 ? '+' : ''}${change} worms`,
              'stock',
              {
                silkworms: Math.max(0, change),
                products: 0,
                cocoons: 0
              }
            );
          });
        });
      }

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

    if (item.category === 'Silkworms' && !item.sourceSpeciesId) {
      await this.warning(
        'This older silkworm listing is not linked to original species stock. ' +
        'Do not adjust it independently. Its link needs safe migration ' +
        'under updated Firestore rules.'
      );
      return;
    }

    if (
      item.sourceSpeciesId &&
      !this.species.some(species => species.id === item.sourceSpeciesId)
    ) {
      await this.warning(
        'The species linked to this product is missing. Check sourceSpeciesId in Firestore.'
      );
      return;
    }

    if (item.sourceSpeciesId) {
      const species = this.species.find(
        entry => entry.id === item.sourceSpeciesId
      );
      if (species && item.quantity !== species.quantity) {
        await this.reconcileLinkedSilkwormStock(item, species);
        return;
      }
    }

    const change = await this.askAdjustment(item.name, item.quantity);
    if (change === null) return;

    this.saving = true;
    this.refresh();

    try {
      if (item.sourceSpeciesId) {
        if (item.category !== 'Silkworms') {
          throw new Error('Only silkworm products can have a species link.');
        }
        const matchingProducts = this.products.filter(product =>
          product.category === 'Silkworms' &&
          product.sourceSpeciesId === item.sourceSpeciesId
        );
        if (matchingProducts.length > 1) {
          throw new Error(
            'Several products reference the same species. Resolve duplicate links first.'
          );
        }
        await this.adjustLinkedSilkwormStock(
          item,
          item.sourceSpeciesId,
          change,
          item.name
        );
      } else {
        await this.inContext(async () => {
          const reference = doc(this.firestore, 'products', item.id);
          const activityReference = doc(
            collection(this.firestore, 'inventory_activity')
          );

          await runTransaction(this.firestore, async transaction => {
            const snapshot = await transaction.get(reference);
            if (!snapshot.exists()) {
              throw new Error('Product no longer exists.');
            }

            if (snapshot.data()['sourceSpeciesId']) {
              throw new Error(
                'Product gained a species link. Reload and retry the linked stock adjustment.'
              );
            }

            const existingColorStocks = snapshot.data()['colorStocks'];
            if (
              Array.isArray(existingColorStocks) &&
              existingColorStocks.length > 0
            ) {
              throw new Error(
                'This product uses color-specific stock. Update individual color quantities using Edit.'
              );
            }

            const current = Number(snapshot.data()['stock']);
            const next = current + change;
            if (
              !this.validWholeNumber(current) ||
              !this.validWholeNumber(next) ||
              next > 100000000
            ) {
              throw new Error('Insufficient product stock or invalid quantity.');
            }

            transaction.update(reference, {
              stock: next,
              updatedAt: serverTimestamp()
            });

            this.addTransactionActivity(
              transaction,
              activityReference,
              'Product stock adjusted',
              `${item.name}: ${change > 0 ? '+' : ''}${change} ${item.unit}`,
              'stock',
              {
                silkworms: 0,
                products: Math.max(0, change),
                cocoons: 0
              }
            );
          });
        });
      }

      await this.success('Product Stock Updated');
    } catch (error: any) {
      await this.firebaseError(error);
    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // DELETE UNUSED INVENTORY RECORDS
  // =========================================

  // Firestore records cannot safely be deleted while a customer
  // order still references them. Older orders sometimes have no
  // productId/sourceSpeciesId, so check their item names as a
  // conservative fallback. This reads orders; it never changes them.
  private async findOrdersUsingInventory(
    species: Pick<Species, 'id' | 'name'> | null,
    product: Pick<SilkProduct, 'id' | 'name' | 'category'> | null
  ): Promise<string[]> {
    const ordersSnapshot = await getDocsFromServer(
      collection(this.firestore, 'orders')
    );

    const matches: string[] = [];
    const speciesName = species
      ? this.normalizedName(species.name)
      : '';
    const productName = product
      ? this.normalizedName(product.name)
      : '';

    for (const orderSnapshot of ordersSnapshot.docs) {
      const order = orderSnapshot.data();
      const items: any[] = Array.isArray(order['items'])
        ? order['items']
        : [];

      const referenced = items.some((entry: any) => {
        const productId = String(entry?.productId || '').trim();
        const speciesId = String(entry?.sourceSpeciesId || '').trim();
        const name = this.normalizedName(String(entry?.name || ''));
        const category = String(entry?.category || '').toLowerCase();

        // The ID is authoritative. Compare names only for old
        // orders that do not carry the corresponding ID.
        const linkedProduct = !!product && (
          productId === product.id ||
          (!productId &&
            name === productName &&
            (category === product.category.toLowerCase() || category === ''))
        );

        const linkedSpecies = !!species && (
          speciesId === species.id ||
          (!speciesId &&
            name === speciesName &&
            (category === 'silkworms' || category === ''))
        );

        return linkedProduct || linkedSpecies;
      });

      if (referenced) matches.push(orderSnapshot.id);
    }

    return matches;
  }

  // Published products must be made unavailable before their
  // removal is finalized. An order placing at the same time must
  // read that product, so the conflicting Firestore transaction
  // will retry instead of committing a stale published state.
  private async unpublishForRemoval(
    productId: string,
    expectedSourceId: string
  ): Promise<void> {
    const reference = doc(this.firestore, 'products', productId);

    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) {
        throw new Error('The product was already removed. Refresh Inventory.');
      }

      const data = snapshot.data();
      if (String(data['sourceSpeciesId'] || '').trim() !== expectedSourceId) {
        throw new Error('The product link changed. Refresh Inventory and retry.');
      }
      if (data['everOrdered'] === true) {
        throw new Error(
          'This product has been used in an order. Keep its record for order history; you can unpublish it instead.'
        );
      }

      if (data['published'] === true) {
        transaction.update(reference, {
          published: false,
          updatedAt: serverTimestamp()
        });
      }
    });
  }

  // For a species, find its single linked selling product. Never
  // guess which older, unlinked listing should be removed.
  private async productToRemoveWithSpecies(
    item: Species
  ): Promise<SilkProduct | null> {
    const snapshot = await getDocsFromServer(
      collection(this.firestore, 'products')
    );
    const linked = snapshot.docs.filter(entry =>
      entry.data()['category'] === 'Silkworms' &&
      String(entry.data()['sourceSpeciesId'] || '').trim() === item.id
    );
    const legacy = snapshot.docs.some(entry =>
      entry.data()['category'] === 'Silkworms' &&
      !String(entry.data()['sourceSpeciesId'] || '').trim() &&
      this.normalizedName(String(entry.data()['name'] || '')) ===
        this.normalizedName(item.name)
    );
    const collision = snapshot.docs.some(entry =>
      entry.id === item.id &&
      !(entry.data()['category'] === 'Silkworms' &&
        String(entry.data()['sourceSpeciesId'] || '').trim() === item.id)
    );

    if (linked.length > 1 || legacy || collision) {
      throw new Error(
        'This species has duplicate, unlinked, or conflicting product records. ' +
        'Review those records first to avoid deleting the wrong inventory.'
      );
    }

    if (!linked.length) return null;
    const entry = linked[0];
    if (entry.data()['everOrdered'] === true) {
      throw new Error(
        'This species has a product used in an order. Keep the species ' +
        'record for history and unpublish the product instead.'
      );
    }

    return {
      id: entry.id,
      name: String(entry.data()['name'] || ''),
      category: 'Silkworms',
      description: String(entry.data()['description'] || ''),
      quantity: Number(entry.data()['stock'] || 0),
      threshold: Number(entry.data()['lowStockThreshold'] ?? 10),
      price: Number(entry.data()['price'] || 0),
      unit: 'worms',
      imageUrl: String(entry.data()['imageUrl'] || ''),
      published: entry.data()['published'] === true,
      featured: entry.data()['featured'] === true,
      colorStocks: [],
      sourceSpeciesId: item.id
    };
  }

  async deleteSpecies(item: Species): Promise<void> {
    if (this.saving) return;
    if (!this.currentUserId || this.auth.currentUser?.uid !== this.currentUserId) {
      await this.warning('Sign in as Admin or Staff before deleting inventory.');
      return;
    }

    const actual = this.species.find(entry => entry.id === item.id);
    if (!actual) {
      await this.warning('Species no longer appears in Inventory. Reload and retry.');
      return;
    }

    this.saving = true;
    this.refresh();
    try {
      const linked = await this.inContext(async () =>
        this.productToRemoveWithSpecies(actual)
      );

      const references = await this.inContext(async () =>
        this.findOrdersUsingInventory(actual, linked)
      );
      if (references.length > 0) {
        throw new Error(
          `This species is referenced by ${references.length} customer order(s). ` +
          'It must be kept for order history; unpublish its product listing instead.'
        );
      }

      this.saving = false;
      this.refresh();
      const confirmation = await Swal.fire({
        icon: 'warning',
        title: 'Permanently Delete Species?',
        html: `Remove <strong>${this.escapeHtml(actual.name)}</strong> ` +
          `(${actual.quantity.toLocaleString('en-PH')} worms)` +
          (linked
            ? ` and its linked product <strong>${this.escapeHtml(linked.name)}</strong>`
            : '') +
          '?<p>This cannot be undone. Order records are never deleted.</p>',
        showCancelButton: true,
        confirmButtonText: 'Delete Permanently',
        cancelButtonText: 'Keep Species',
        confirmButtonColor: '#bf3e3e',
        reverseButtons: true
      });
      if (!confirmation.isConfirmed) return;

      this.saving = true;
      this.refresh();
      await this.inContext(async () => {
        // Make an existing listing unavailable before checking for
        // concurrent orders; otherwise checkout could race deletion.
        if (linked) {
          await this.unpublishForRemoval(linked.id, actual.id);
        }

        const latestLinked = await this.productToRemoveWithSpecies(actual);
        if (!!latestLinked !== !!linked) {
          throw new Error('Linked products changed. Reload and retry.');
        }
        if (linked && latestLinked?.id !== linked.id) {
          throw new Error('The linked product changed. Reload and retry.');
        }

        const currentReferences = await this.findOrdersUsingInventory(
          actual,
          linked
        );
        if (currentReferences.length) {
          throw new Error(
            'A customer order now references this inventory. The product has ' +
            'been unpublished to prevent further orders; no records were deleted.'
          );
        }

        const speciesRef = doc(
          this.firestore,
          'inventory_species',
          actual.id
        );
        const linkedRef = linked
          ? doc(this.firestore, 'products', linked.id)
          : null;
        const activityRef = doc(
          collection(this.firestore, 'inventory_activity')
        );

        await runTransaction(this.firestore, async transaction => {
          const speciesSnapshot = await transaction.get(speciesRef);
          const productSnapshot = linkedRef
            ? await transaction.get(linkedRef)
            : null;
          if (!speciesSnapshot.exists()) {
            throw new Error('The species was already deleted. Reload Inventory.');
          }
          const fresh = speciesSnapshot.data();
          if (String(fresh['name'] || '') !== actual.name ||
              Number(fresh['quantity']) !== actual.quantity) {
            throw new Error(
              'Species name or stock changed during deletion. Reload and confirm again.'
            );
          }

          if (linkedRef) {
            if (!productSnapshot?.exists()) {
              throw new Error('Linked product changed. Reload and retry.');
            }
            const currentProduct = productSnapshot.data();
            if (String(currentProduct?.['sourceSpeciesId'] || '') !== actual.id ||
                currentProduct?.['category'] !== 'Silkworms' ||
                currentProduct?.['published'] === true ||
                currentProduct?.['everOrdered'] === true) {
              throw new Error('The linked product is not safe to delete. Reload Inventory.');
            }
            transaction.delete(linkedRef);
          }

          transaction.delete(speciesRef);
          this.addTransactionActivity(
            transaction,
            activityRef,
            'Silkworm species permanently deleted',
            `${actual.name} — removed ${actual.quantity} worms` +
              (linked ? ` and linked listing ${linked.name}` : ''),
            'remove'
          );
        });
      });

      await this.success('Species Deleted');
    } catch (error: any) {
      await this.firebaseError(error);
    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  async deleteProduct(item: SilkProduct): Promise<void> {
    if (this.saving) return;
    if (!this.currentUserId || this.auth.currentUser?.uid !== this.currentUserId) {
      await this.warning('Sign in as Admin or Staff before deleting products.');
      return;
    }

    const actual = this.products.find(entry => entry.id === item.id);
    if (!actual) {
      await this.warning('Product no longer appears in Inventory. Reload and retry.');
      return;
    }

    this.saving = true;
    this.refresh();
    try {
      const references = await this.inContext(async () =>
        this.findOrdersUsingInventory(null, actual)
      );
      if (references.length) {
        throw new Error(
          `This product is referenced by ${references.length} customer order(s). ` +
          'It cannot be deleted without breaking order history. Unpublish it instead.'
        );
      }

      this.saving = false;
      this.refresh();
      const confirmation = await Swal.fire({
        icon: 'warning',
        title: 'Permanently Delete Product?',
        html: `Remove <strong>${this.escapeHtml(actual.name)}</strong> ` +
          'from Product Inventory?<p>' +
          (actual.sourceSpeciesId
            ? 'The original silkworm species and its stock will remain unchanged.'
            : 'Any independent stock in this product record will be removed.') +
          ' This cannot be undone.</p>',
        showCancelButton: true,
        confirmButtonText: 'Delete Permanently',
        cancelButtonText: 'Keep Product',
        confirmButtonColor: '#bf3e3e',
        reverseButtons: true
      });
      if (!confirmation.isConfirmed) return;

      this.saving = true;
      this.refresh();
      await this.inContext(async () => {
        const expectedSource = String(actual.sourceSpeciesId || '');
        await this.unpublishForRemoval(actual.id, expectedSource);

        const currentReferences = await this.findOrdersUsingInventory(
          null,
          actual
        );
        if (currentReferences.length) {
          throw new Error(
            'This product is now referenced by a customer order. It was ' +
            'unpublished, and its inventory record was kept.'
          );
        }

        const productRef = doc(this.firestore, 'products', actual.id);
        const activityRef = doc(
          collection(this.firestore, 'inventory_activity')
        );
        await runTransaction(this.firestore, async transaction => {
          const snapshot = await transaction.get(productRef);
          if (!snapshot.exists()) {
            throw new Error('Product was already removed. Reload Inventory.');
          }
          const latest = snapshot.data();
          if (String(latest['sourceSpeciesId'] || '') !== expectedSource ||
              String(latest['name'] || '') !== actual.name ||
              latest['published'] === true ||
              latest['everOrdered'] === true) {
            throw new Error('The product changed or has order history. Reload and retry.');
          }

          transaction.delete(productRef);
          this.addTransactionActivity(
            transaction,
            activityRef,
            'Silk product permanently deleted',
            `${actual.name} — removed product listing; ` +
              (expectedSource
                ? 'original silkworm species stock preserved'
                : `${actual.quantity} independent units removed`),
            'remove'
          );
        });
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
    if (this.saving || this.processingImage) return;

    // Show actual quantities instead of adjustment amounts.
    this.originalCocoons = { ...this.cocoons };

    this.cocoonGoodChange = this.cocoons.good;
    this.cocoonMinorChange = this.cocoons.minor;
    this.cocoonUnusableChange = this.cocoons.unusable;

    this.cocoonLowStockThreshold =
      this.cocoons.lowStockThreshold;

    this.cocoonImageUrl = this.cocoons.imageUrl;
    this.imageError = '';
    this.showCocoonEditor = true;
  }

  closeCocoonEditor(): void {
    if (this.saving || this.processingImage) return;

    this.showCocoonEditor = false;
    this.originalCocoons = null;
    this.imageError = '';
  }

  adjustCocoons(): void {
    this.openCocoonEditor();
  }

  async saveCocoonChanges(): Promise<void> {
    if (
      this.saving ||
      this.processingImage ||
      !this.currentUserId
    ) {
      return;
    }

    const original = this.originalCocoons;

    if (!original) {
      await this.warning(
        'Reopen the cocoon editor before saving.'
      );
      return;
    }

    const good = Number(this.cocoonGoodChange);
    const minor = Number(this.cocoonMinorChange);
    const unusable = Number(this.cocoonUnusableChange);
    const threshold =
      Number(this.cocoonLowStockThreshold);
    const imageUrl = this.cocoonImageUrl;

    if (
      !this.validWholeNumber(this.cocoonGoodChange) ||
      !this.validWholeNumber(this.cocoonMinorChange) ||
      !this.validWholeNumber(this.cocoonUnusableChange) ||
      !this.validWholeNumber(this.cocoonLowStockThreshold) ||
      !this.validImage(imageUrl)
    ) {
      await this.warning(
        'Enter non-negative whole numbers and a valid image.'
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
          collection(this.firestore, 'inventory_activity')
        );

        await runTransaction(
          this.firestore,
          async transaction => {
            const snapshot =
              await transaction.get(reference);

            const record = snapshot.exists()
              ? snapshot.data()
              : {};

            const current: Cocoons = {
              good: Number(record['good'] || 0),
              minor: Number(record['minor'] || 0),
              unusable: Number(record['unusable'] || 0),
              reserved: Number(record['reserved'] || 0),
              imageUrl: String(record['imageUrl'] || ''),
              lowStockThreshold:
                this.validWholeNumber(record['lowStockThreshold'])
                  ? Number(record['lowStockThreshold'])
                  : 10
            };

            const quantitiesChanged =
              good !== original.good ||
              minor !== original.minor ||
              unusable !== original.unusable;

            const remotelyChanged =
              current.good !== original.good ||
              current.minor !== original.minor ||
              current.unusable !== original.unusable;

            // Do not overwrite stock modified by another session.
            if (
              quantitiesChanged &&
              remotelyChanged
            ) {
              throw new Error(
                'Cocoon quantities changed while you were editing. Reopen the editor.'
              );
            }

            const thresholdChanged =
              threshold !== original.lowStockThreshold;

            if (
              thresholdChanged &&
              current.lowStockThreshold !== original.lowStockThreshold &&
              current.lowStockThreshold !== threshold
            ) {
              throw new Error(
                'The cocoon threshold changed. Reopen the editor.'
              );
            }

            const imageChanged =
              imageUrl !== original.imageUrl;

            if (
              imageChanged &&
              current.imageUrl !== original.imageUrl &&
              current.imageUrl !== imageUrl
            ) {
              throw new Error(
                'The cocoon image changed. Reopen the editor.'
              );
            }

            const next: Cocoons = {
              good: quantitiesChanged ? good : current.good,
              minor: quantitiesChanged ? minor : current.minor,
              unusable:
                quantitiesChanged ? unusable : current.unusable,
              reserved: current.reserved,
              imageUrl: imageChanged
                ? imageUrl
                : current.imageUrl,
              lowStockThreshold: thresholdChanged
                ? threshold
                : current.lowStockThreshold
            };

            if (next.reserved > next.good) {
              throw new Error(
                'Good-quality cocoons cannot be fewer than reserved cocoons. Adjust reservations first.'
              );
            }

            const delta =
              Math.max(0, next.good - current.good) +
              Math.max(0, next.minor - current.minor) +
              Math.max(0, next.unusable - current.unusable);

            const updatedData = {
              ...next,
              updatedAt: serverTimestamp(),
              updatedBy: this.currentUserId
            };

            if (snapshot.exists()) {
              transaction.update(reference, updatedData);
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
              `Good: ${current.good} → ${next.good}, ` +
              `Minor: ${current.minor} → ${next.minor}, ` +
              `Not usable: ${current.unusable} → ${next.unusable}`,
              'cocoon',
              {
                silkworms: 0,
                products: 0,
                cocoons: delta
              }
            );
          }
        );
      });

      this.showCocoonEditor = false;
      this.originalCocoons = null;

      await this.success('Cocoon Inventory Saved');
    } catch (error: any) {
      await this.firebaseError(error);
    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  // =========================================
  // COCOON RESERVATIONS
  // =========================================

  async updateReservations(): Promise<void> {
    if (this.saving) return;

    const result = await Swal.fire({
      icon: 'question',
      title: 'Manage Reserved Cocoons',
      text:
        `Good: ${this.cocoons.good}. ` +
        `Reserved: ${this.cocoons.reserved}.`,
      input: 'number',
      inputValue: String(this.cocoons.reserved),
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
          collection(this.firestore, 'inventory_activity')
        );

        await runTransaction(
          this.firestore,
          async transaction => {
            const snapshot =
              await transaction.get(reference);

            const record = snapshot.exists()
              ? snapshot.data()
              : {};

            const current: Cocoons = {
              good: Number(record['good'] || 0),
              minor: Number(record['minor'] || 0),
              unusable: Number(record['unusable'] || 0),
              reserved: Number(record['reserved'] || 0),
              imageUrl: String(record['imageUrl'] || ''),
              lowStockThreshold:
                this.validWholeNumber(record['lowStockThreshold'])
                  ? Number(record['lowStockThreshold'])
                  : 10
            };

            if (reserved > current.good) {
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

      await this.success('Reservations Updated');
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
        text: 'There are no low-stock records.',
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
    this.router.navigate(['/home-adm/products']);
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

    let date: Date;

    if (typeof value.toDate === 'function') {
      date = value.toDate();
    } else if (typeof value.seconds === 'number') {
      date = new Date(value.seconds * 1000);
    } else {
      date = new Date(value);
    }

    return Number.isFinite(date.getTime())
      ? date
      : null;
  }

  private signedAmount(
    value: string
  ): number {
    const amount = Number(
      String(value).replace(/,/g, '').trim()
    );

    return Number.isFinite(amount)
      ? amount
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

    // Prefer numeric values stored with newer
    // inventory activity records.
    if (activity.productionDelta) {
      return {
        silkworms: Math.max(
          0,
          Number(activity.productionDelta.silkworms) || 0
        ),
        products: Math.max(
          0,
          Number(activity.productionDelta.products) || 0
        ),
        cocoons: Math.max(
          0,
          Number(activity.productionDelta.cocoons) || 0
        )
      };
    }

    // Compatibility with older Firebase activity
    // records that stored changes as text.
    const detail = activity.detail || '';
    const message = activity.message
      .trim()
      .toLowerCase();

    if (message === 'silkworm species added') {
      const match = detail.match(
        /—\s*([\d,]+)\s*worms/i
      );

      if (match) {
        totals.silkworms =
          this.signedAmount(match[1]);
      }
    }

    if (message === 'silkworm stock adjusted') {
      const match = detail.match(
        /:\s*([+-]?\d[\d,]*)\s*worms/i
      );

      if (match) {
        totals.silkworms =
          this.signedAmount(match[1]);
      }
    }

    if (message === 'silk product added') {
      const match = detail.match(
        /—\s*([\d,]+)\s*(?:pcs|worms|cocoons)/i
      );

      if (match) {
        totals.products =
          this.signedAmount(match[1]);
      }
    }

    if (message === 'product stock adjusted') {
      const match = detail.match(
        /:\s*([+-]?\d[\d,]*)\s*(?:pcs|worms|cocoons)/i
      );

      if (match) {
        totals.products =
          this.signedAmount(match[1]);
      }
    }

    if (message === 'cocoon inventory updated') {
      // Old records: Good: +10, Minor: +5.
      const oldGood = detail.match(
        /Good:\s*([+-]?\d[\d,]*)\s*(?:,|$)/i
      );

      const oldMinor = detail.match(
        /Minor:\s*([+-]?\d[\d,]*)\s*(?:,|$)/i
      );

      const oldUnusable = detail.match(
        /Not usable:\s*([+-]?\d[\d,]*)\s*(?:,|$)/i
      );

      const oldValues = [
        oldGood,
        oldMinor,
        oldUnusable
      ];

      if (oldValues.some(Boolean)) {
        totals.cocoons = oldValues.reduce(
          (sum, match) =>
            sum + (
              match
                ? Math.max(
                    0,
                    this.signedAmount(match[1])
                  )
                : 0
            ),
          0
        );

        return totals;
      }

      // Newer text format: Good: 10 → 15.
      // Structured productionDelta takes priority.
      const changes = [
        /Good:\s*([\d,]+)\s*→\s*([\d,]+)/i,
        /Minor:\s*([\d,]+)\s*→\s*([\d,]+)/i,
        /Not usable:\s*([\d,]+)\s*→\s*([\d,]+)/i
      ];

      totals.cocoons = changes.reduce(
        (sum, expression) => {
          const match = detail.match(expression);

          if (!match) return sum;

          return sum + Math.max(
            0,
            this.signedAmount(match[2]) -
              this.signedAmount(match[1])
          );
        },
        0
      );
    }

    return totals;
  }

  private sameGraphPeriod(
    date: Date,
    target: Date
  ): boolean {
    if (
      date.getFullYear() !== target.getFullYear() ||
      date.getMonth() !== target.getMonth()
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

    for (const activity of this.activities) {
      const date = this.productionDate(
        activity.createdAt
      );

      if (
        !date ||
        !this.sameGraphPeriod(date, target)
      ) {
        continue;
      }

      const amounts =
        this.getActivityProduction(activity);

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

    for (let index = 0; index < count; index++) {
      const target = new Date(today);

      if (this.productionPeriod === 'daily') {
        target.setDate(
          today.getDate() - (count - index - 1)
        );
      } else {
        target.setDate(1);
        target.setMonth(
          today.getMonth() - (count - index - 1)
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
            (this.graphRight - this.graphLeft) /
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

    const maximum = Math.max(0, ...values);

    if (maximum <= 0) return 4;

    const magnitude = Math.pow(
      10,
      Math.floor(Math.log10(maximum))
    );

    const step = magnitude / 2;

    return Math.ceil(maximum / step) * step;
  }

  graphY(value: number): number {
    const safeValue = Math.max(0, value);

    return (
      this.graphBottom -
      safeValue /
        this.graphMaximum *
        (this.graphBottom - this.graphTop)
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
          this.graphMaximum * index / 4;

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
            `${point.x},${this.graphY(point[line.key])}`
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

    if (typeof value.toMillis === 'function') {
      return value.toMillis();
    }

    if (typeof value.seconds === 'number') {
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
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };

    return value.replace(
      /[&<>"']/g,
      character => replacements[character]
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
