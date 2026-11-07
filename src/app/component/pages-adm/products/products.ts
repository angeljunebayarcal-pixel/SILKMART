import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectorRef, Component, Injector, NgZone, OnDestroy, OnInit, runInInjectionContext } from '@angular/core';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Firestore, collection, collectionData, doc, getDocs, getDocsFromServer, runTransaction, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';
type ProductStatusFilter = 'All' | 'Published' | 'Draft' | 'Out of Stock';
interface ProductColorStock {
    name: string;
    quantity: number;
    lowStockThreshold?: number;
}
interface ShopProduct {
    id: string;
    name: string;
    category: string;
    description: string;
    price: number;
    stock: number;
    lowStockThreshold: number;
    sourceSpeciesId?: string;
    imageUrl: string;
    published: boolean;
    featured: boolean;
    createdAt: any;
    updatedAt: any;
    colorStocks: ProductColorStock[];
}
interface SpeciesOption {
    id: string;
    name: string;
    quantity: number;
}
interface ProductForm {
    name: string;
    category: string;
    description: string;
    price: number | null;
    stock: number | null;
    lowStockThreshold: number;
    sourceSpeciesId?: string;
    imageUrl: string;
    published: boolean;
    featured: boolean;
    colorStocks: ProductColorStock[];
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
    private originalEditingProduct: ShopProduct | null = null;
    private destroyed = false;
    currentUserId = '';
    loading = true;
    saving = false;
    errorMessage = '';
    products: ShopProduct[] = [];
    selectedProduct: ShopProduct | null = null;
    showAllSelectedColors = false;
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
    constructor(private auth: Auth, private firestore: Firestore, private injector: Injector, private zone: NgZone, private cdr: ChangeDetectorRef) {
        this.productCollection = runInInjectionContext(this.injector, () => collection(this.firestore, 'products'));
    }
    private inContext<T>(callback: () => T): T {
        return runInInjectionContext(this.injector, callback);
    }
    private refresh(): void {
        if (!this.destroyed) {
            this.cdr.detectChanges();
        }
    }
    // =========================================
    // INITIALIZATION
    // =========================================
    ngOnInit(): void {
        this.destroyed = false;
        this.authUnsubscribe = this.inContext(() => onAuthStateChanged(this.auth, user => this.zone.run(() => {
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
            this.refresh();
        }), error => this.zone.run(() => {
            console.error('Authentication error:', error);
            this.currentUserId = '';
            this.loading = false;
            this.errorMessage =
                'Unable to verify your Firebase account.';
            this.refresh();
        })));
    }
    ngOnDestroy(): void {
        this.destroyed = true;
        this.productsSubscription?.unsubscribe();
        this.authUnsubscribe?.();
    }
    // =========================================
    // FIRESTORE PRODUCT CATALOG
    // =========================================
    loadProducts(): void {
        if (!this.currentUserId)
            return;
        this.productsSubscription?.unsubscribe();
        this.loading = true;
        this.errorMessage = '';
        const uid = this.currentUserId;
        this.productsSubscription = this.inContext(() => collectionData(this.productCollection, { idField: 'id' }).subscribe({
            next: records => this.zone.run(() => {
                if (this.destroyed ||
                    uid !== this.currentUserId) {
                    return;
                }
                this.products = records.map(record => this.normalizeProduct(record));
                if (this.selectedProduct) {
                    this.selectedProduct =
                        this.products.find(item => item.id === this.selectedProduct?.id) || null;
                }
                this.loading = false;
                this.errorMessage = '';
                this.refresh();
            }),
            error: error => this.zone.run(() => {
                if (this.destroyed)
                    return;
                console.error('Products load error:', error);
                this.loading = false;
                this.errorMessage =
                    error?.code === 'permission-denied'
                        ? 'Firebase denied access. Check your Staff/Admin role and product security rules.'
                        : 'Unable to load products from Firebase.';
                this.refresh();
            })
        }));
    }
    // =========================================
    // NUMBER AND PRODUCT NORMALIZATION
    // =========================================
    private defaultThreshold(category: string): number {
        return category === 'Silkworms'
            ? 10
            : 100;
    }
    private validWholeNumber(value: unknown): boolean {
        return (value !== null &&
            value !== undefined &&
            value !== '' &&
            Number.isInteger(Number(value)) &&
            Number(value) >= 0 &&
            Number.isSafeInteger(Number(value)));
    }
    private normalizeColorStocks(value: unknown): ProductColorStock[] {
        if (!Array.isArray(value))
            return [];
        return value
            .filter((color: any) => typeof color?.name === 'string' &&
            this.validWholeNumber(color.quantity))
            .map((color: any) => ({
            name: String(color.name),
            quantity: Number(color.quantity),
            lowStockThreshold: this.validWholeNumber(color.lowStockThreshold)
                ? Number(color.lowStockThreshold)
                : 0
        }));
    }
    private normalizeProduct(raw: any): ShopProduct {
        const category = String(raw.category || 'Other');
        return {
            id: String(raw.id || ''),
            name: String(raw.name || ''),
            category,
            description: String(raw.description || ''),
            price: Number(raw.price || 0),
            stock: Number(raw.stock || 0),
            lowStockThreshold: this.validWholeNumber(raw.lowStockThreshold)
                ? Number(raw.lowStockThreshold)
                : this.defaultThreshold(category),
            ...(typeof raw.sourceSpeciesId === 'string' &&
                raw.sourceSpeciesId.trim()
                ? {
                    sourceSpeciesId: raw.sourceSpeciesId.trim()
                }
                : {}),
            imageUrl: String(raw.imageUrl || ''),
            published: raw.published === true,
            featured: raw.featured === true,
            createdAt: raw.createdAt || null,
            updatedAt: raw.updatedAt || null,
            colorStocks: this.normalizeColorStocks(raw.colorStocks)
        };
    }
    // =========================================
    // INVENTORY DISPLAY HELPERS
    // =========================================
    isSilkwormProduct(product: ShopProduct | ProductForm): boolean {
        return product.category === 'Silkworms';
    }
    getStockUnit(product: ShopProduct | ProductForm): string {
        if (product.category === 'Silkworms') {
            return 'worms';
        }
        if (product.category === 'Cocoons') {
            return 'cocoons';
        }
        return 'pcs';
    }
    getProductThreshold(product: ShopProduct): number {
        return product.lowStockThreshold;
    }
    isLowStock(product: ShopProduct): boolean {
        return (product.stock > 0 &&
            product.stock <= product.lowStockThreshold);
    }
    isColorLowStock(color: ProductColorStock): boolean {
        const threshold = Number(color.lowStockThreshold ?? 0);
        return (color.quantity > 0 &&
            color.quantity <= threshold);
    }
    getColorStockLabel(color: ProductColorStock): string {
        if (color.quantity <= 0) {
            return 'Out of Stock';
        }
        return this.isColorLowStock(color)
            ? 'Low Stock'
            : 'In Stock';
    }
    getColorStockClass(color: ProductColorStock): string {
        if (color.quantity <= 0) {
            return 'stock-empty';
        }
        return this.isColorLowStock(color)
            ? 'stock-low'
            : 'stock-good';
    }
    // =========================================
    // SUMMARY CARDS
    // =========================================
    get totalProducts(): number {
        return this.products.length;
    }
    get publishedProducts(): number {
        return this.products.filter(item => item.published).length;
    }
    get draftProducts(): number {
        return this.products.filter(item => !item.published).length;
    }
    isProductOutOfStock(product: ShopProduct): boolean {
        return (product.stock <= 0 ||
            product.colorStocks.some(color => color.quantity <= 0));
    }
    get outOfStockProducts(): number {
        return this.products.filter(item => this.isProductOutOfStock(item)).length;
    }
    get lowStockProducts(): number {
        return this.products.filter(item => this.isLowStock(item) ||
            item.colorStocks.some(color => this.isColorLowStock(color) ||
                color.quantity === 0)).length;
    }
    // =========================================
    // FILTERS AND SORTING
    // =========================================
    get filteredProducts(): ShopProduct[] {
        const term = this.searchTerm.trim().toLowerCase();
        return this.products
            .filter(product => {
            const searchableText = [
                product.name,
                product.category,
                product.description,
                product.id
            ].join(' ').toLowerCase();
            const matchesSearch = !term || searchableText.includes(term);
            const matchesCategory = this.categoryFilter === 'All Categories' ||
                this.categoryFilter === product.category;
            let matchesStatus = true;
            if (this.statusFilter === 'Published') {
                matchesStatus = product.published;
            }
            else if (this.statusFilter === 'Draft') {
                matchesStatus = !product.published;
            }
            else if (this.statusFilter === 'Out of Stock') {
                matchesStatus =
                    this.isProductOutOfStock(product);
            }
            let matchesStock = true;
            if (this.stockFilter === 'In Stock') {
                matchesStock = product.stock > 0;
            }
            else if (this.stockFilter === 'Low Stock') {
                matchesStock =
                    this.isLowStock(product) ||
                        product.colorStocks.some(color => this.isColorLowStock(color));
            }
            else if (this.stockFilter === 'Out of Stock') {
                matchesStock =
                    this.isProductOutOfStock(product);
            }
            return (matchesSearch &&
                matchesCategory &&
                matchesStatus &&
                matchesStock);
        })
            .sort((a, b) => {
            switch (this.sortBy) {
                case 'oldest':
                    return (this.toMillis(a.createdAt) -
                        this.toMillis(b.createdAt));
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'priceLow':
                    return a.price - b.price;
                case 'priceHigh':
                    return b.price - a.price;
                case 'stockLow':
                    return a.stock - b.stock;
                default:
                    return (this.toMillis(b.createdAt) -
                        this.toMillis(a.createdAt));
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
    trackProduct(_index: number, product: ShopProduct): string {
        return product.id;
    }
    selectProduct(product: ShopProduct): void {
        if (this.selectedProduct?.id !== product.id) {
            this.showAllSelectedColors = false;
        }
        this.selectedProduct = product;
    }
    toggleSelectedColors(): void {
        this.showAllSelectedColors =
            !this.showAllSelectedColors;
    }
    // =========================================
    // PRODUCT COLOR MANAGEMENT
    // =========================================
    canManageProductColors(): boolean {
        const category = this.productForm.category
            .trim()
            .toLowerCase();
        return (category !== 'silkworms' &&
            category !== 'cocoons');
    }
    hasProductColorStock(): boolean {
        return (this.canManageProductColors() &&
            this.productForm.colorStocks.length > 0);
    }
    hasSelectedProductColor(name: string): boolean {
        return this.productForm.colorStocks.some(color => color.name === name);
    }
    toggleProductColor(name: string): void {
        if (!this.canManageProductColors())
            return;
        if (!this.availableProductColors.some(color => color.name === name)) {
            return;
        }
        if (this.hasSelectedProductColor(name)) {
            this.productForm.colorStocks =
                this.productForm.colorStocks.filter(color => color.name !== name);
        }
        else {
            this.productForm.colorStocks.push({
                name,
                quantity: 0,
                lowStockThreshold: 0
            });
        }
        this.syncProductColorTotal();
    }
    setProductColorQuantity(name: string, value: number | string): void {
        const color = this.productForm.colorStocks.find(item => item.name === name);
        if (!color)
            return;
        color.quantity = Number(value);
        this.syncProductColorTotal();
    }
    setProductColorThreshold(name: string, value: number | string): void {
        const color = this.productForm.colorStocks.find(item => item.name === name);
        if (!color)
            return;
        color.lowStockThreshold = Number(value);
    }
    get productColorStockTotal(): number {
        return this.productForm.colorStocks.reduce((total, color) => {
            const quantity = Number(color.quantity);
            return total + (Number.isInteger(quantity) &&
                quantity > 0
                ? quantity
                : 0);
        }, 0);
    }
    syncProductColorTotal(): void {
        if (!this.canManageProductColors())
            return;
        this.productForm.stock =
            this.productColorStockTotal;
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
            lowStockThreshold: 100,
            imageUrl: '',
            published: false,
            featured: false,
            colorStocks: []
        };
    }
    openAddProduct(): void {
        if (this.saving)
            return;
        this.editingProductId = null;
        this.originalEditingProduct = null;
        this.productForm = this.emptyForm();
        this.formError = '';
        this.showProductModal = true;
    }
    openEditProduct(product: ShopProduct): void {
        if (this.saving)
            return;
        if (this.selectedProduct?.id !== product.id) {
            this.showAllSelectedColors = false;
        }
        this.selectedProduct = product;
        this.editingProductId = product.id;
        this.originalEditingProduct = {
            ...product,
            colorStocks: product.colorStocks.map(color => ({ ...color }))
        };
        this.productForm = {
            name: product.name,
            category: product.category,
            description: product.description,
            price: product.price,
            stock: product.stock,
            lowStockThreshold: product.lowStockThreshold,
            ...(product.sourceSpeciesId
                ? {
                    sourceSpeciesId: product.sourceSpeciesId
                }
                : {}),
            imageUrl: product.imageUrl,
            published: product.published,
            featured: product.featured,
            colorStocks: product.colorStocks.map(color => ({ ...color }))
        };
        this.formError = '';
        this.showProductModal = true;
    }
    closeProductModal(): void {
        if (this.saving)
            return;
        this.showProductModal = false;
        this.editingProductId = null;
        this.originalEditingProduct = null;
        this.formError = '';
    }
    // =========================================
    // IMAGE VALIDATION
    // =========================================
    private validImage(image: string): boolean {
        const value = image.trim();
        if (!value)
            return true;
        if (value.startsWith('data:image/jpeg;base64,')) {
            return (value.length <= 180000 &&
                /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value));
        }
        if (value.length > 2048) {
            return false;
        }
        try {
            const url = new URL(value);
            return (url.protocol === 'http:' ||
                url.protocol === 'https:');
        }
        catch {
            return false;
        }
    }
    // =========================================
    // FORM VALIDATION
    // =========================================
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
        if (form.price === null ||
            !Number.isFinite(Number(form.price)) ||
            Number(form.price) < 0) {
            return 'Please enter a valid selling price.';
        }
        if (!this.validWholeNumber(form.lowStockThreshold)) {
            return 'The low-stock threshold must be zero or a positive whole number.';
        }
        if (Number(form.lowStockThreshold) >
            100000000) {
            return 'The low-stock threshold is too large.';
        }
        if (this.canManageProductColors() &&
            form.colorStocks.length > 0) {
            const names = new Set(form.colorStocks.map(color => color.name));
            if (names.size !==
                form.colorStocks.length) {
                return 'Duplicate product colors are not allowed.';
            }
            for (const color of form.colorStocks) {
                if (!this.availableProductColors.some(option => option.name === color.name)) {
                    return 'Invalid product color.';
                }
                if (!this.validWholeNumber(color.quantity)) {
                    return `Enter a valid stock quantity for ${color.name}.`;
                }
                if (!this.validWholeNumber(color.lowStockThreshold ?? 0)) {
                    return `Enter a valid low-stock threshold for ${color.name}.`;
                }
                if (Number(color.lowStockThreshold ?? 0) > 100000000) {
                    return `The threshold for ${color.name} is too large.`;
                }
            }
        }
        // New silkworm products use the source species stock, not
        // an independently entered quantity. The existing stock field
        // remains available when editing a properly linked product.
        const newSilkworm = !this.editingProductId && form.category === 'Silkworms';
        const stock = this.hasProductColorStock()
            ? this.productColorStockTotal
            : form.stock;
        if (!newSilkworm && !this.validWholeNumber(stock)) {
            return 'Stock must be zero or a positive whole number.';
        }
        if (!newSilkworm && Number(stock) > 100000000) {
            return 'Stock quantity is too large.';
        }
        if (!this.validImage(form.imageUrl)) {
            return 'Please provide a valid image URL or compressed Base64 JPEG image.';
        }
        if (form.sourceSpeciesId && form.category !== 'Silkworms') {
            return 'A linked silkworm product must remain in the Silkworms category.';
        }
        if (this.editingProductId &&
            form.category === 'Silkworms' &&
            !this.originalEditingProduct?.sourceSpeciesId &&
            this.originalEditingProduct?.category !== 'Silkworms') {
            return 'Create a new silkworm listing from an existing species instead of converting another product category.';
        }
        return '';
    }
    // =========================================
    // SAFE STOCK COMPARISON
    // =========================================
    private quantitiesEqual(a: ProductColorStock[], b: ProductColorStock[]): boolean {
        if (a.length !== b.length) {
            return false;
        }
        const quantities = new Map(a.map(color => [
            color.name,
            Number(color.quantity)
        ]));
        if (quantities.size !== a.length) {
            return false;
        }
        return b.every(color => quantities.has(color.name) &&
            quantities.get(color.name) ===
                Number(color.quantity));
    }
    private thresholdsEqual(a: ProductColorStock[], b: ProductColorStock[]): boolean {
        if (a.length !== b.length) {
            return false;
        }
        const thresholds = new Map(a.map(color => [
            color.name,
            Number(color.lowStockThreshold ?? 0)
        ]));
        if (thresholds.size !== a.length) {
            return false;
        }
        return b.every(color => thresholds.has(color.name) &&
            thresholds.get(color.name) ===
                Number(color.lowStockThreshold ?? 0));
    }
    private mergeColorThresholds(original: ProductColorStock[], desired: ProductColorStock[], current: ProductColorStock[]): ProductColorStock[] {
        const originalMap = new Map(original.map(color => [
            color.name,
            Number(color.lowStockThreshold ?? 0)
        ]));
        const desiredMap = new Map(desired.map(color => [
            color.name,
            Number(color.lowStockThreshold ?? 0)
        ]));
        return current.map(color => {
            const previousThreshold = originalMap.get(color.name) ?? 0;
            const desiredThreshold = desiredMap.get(color.name) ??
                previousThreshold;
            const currentThreshold = Number(color.lowStockThreshold ?? 0);
            const userChangedThreshold = desiredThreshold !==
                previousThreshold;
            if (userChangedThreshold &&
                currentThreshold !== previousThreshold &&
                currentThreshold !== desiredThreshold) {
                throw new Error(`The threshold for ${color.name} changed while you were editing. Reopen the product.`);
            }
            return {
                ...color,
                lowStockThreshold: userChangedThreshold
                    ? desiredThreshold
                    : currentThreshold
            };
        });
    }
    // =========================================
    // AUTOMATIC SILKWORM SPECIES LINKING
    // =========================================
    private normalizedSpeciesName(value: string): string {
        return value.trim().toLocaleLowerCase();
    }
    private async resolveSpeciesForNewProduct(productName: string): Promise<SpeciesOption | null> {
        const speciesSnapshot = await this.inContext(() => getDocs(collection(this.firestore, 'inventory_species')));
        const productsSnapshot = await this.inContext(() => getDocs(this.productCollection));
        const linked = new Set<string>();
        const legacyNames = new Set<string>();
        for (const existingDoc of productsSnapshot.docs) {
            const existing = existingDoc.data() || {};
            if (String(existing['category'] || '') !== 'Silkworms')
                continue;
            const sourceId = String(existing['sourceSpeciesId'] || '').trim();
            if (sourceId)
                linked.add(sourceId);
            else
                legacyNames.add(this.normalizedSpeciesName(String(existing['name'] || '')));
        }
        const options = speciesSnapshot.docs.map(snapshot => ({
            id: snapshot.id,
            name: String(snapshot.data()?.['name'] || '').trim(),
            quantity: Number(snapshot.data()?.['quantity'])
        })).filter(species => !!species.name &&
            this.validWholeNumber(species.quantity) &&
            species.quantity <= 100000000 &&
            !linked.has(species.id) &&
            !legacyNames.has(this.normalizedSpeciesName(species.name)) &&
            !productsSnapshot.docs.some(item => item.id === species.id)).sort((a, b) => a.name.localeCompare(b.name));
        if (!options.length) {
            throw new Error('No unlisted silkworm species is available. Add a species in ' +
                'Inventory first, or review an older unlinked product with a ' +
                'matching name before creating another listing.');
        }
        const exactMatches = options.filter(species => this.normalizedSpeciesName(species.name) ===
            this.normalizedSpeciesName(productName));
        if (exactMatches.length === 1)
            return exactMatches[0];
        const inputOptions: Record<string, string> = {};
        for (const species of options) {
            inputOptions[species.id] =
                `${species.name} — ${species.quantity.toLocaleString('en-PH')} worms`;
        }
        const result = await Swal.fire({
            title: 'Connect Silkworm Species',
            text: 'Select the original species. The product will use its entire current quantity; no separate stock allocation will be created.',
            input: 'select',
            inputOptions,
            inputPlaceholder: 'Choose an existing species',
            showCancelButton: true,
            confirmButtonText: 'Connect and Save',
            cancelButtonText: 'Back to Product',
            confirmButtonColor: '#287457',
            preConfirm: (value: any) => {
                if (!options.some(species => species.id === String(value))) {
                    Swal.showValidationMessage('Please select a species.');
                    return false;
                }
                return String(value);
            }
        });
        if (!result.isConfirmed || !result.value)
            return null;
        return options.find(species => species.id === result.value) || null;
    }
    private async assertSpeciesNotListed(species: SpeciesOption): Promise<void> {
        // Protect older listings that use random product IDs. All new
        // entry points use products/{speciesId} to prevent two simultaneous
        // creates from producing two canonical listings.
        const products = await this.inContext(() => getDocs(this.productCollection));
        for (const existing of products.docs) {
            const data = existing.data() || {};
            if (String(data['category'] || '') !== 'Silkworms')
                continue;
            if (String(data['sourceSpeciesId'] || '').trim() === species.id) {
                throw new Error('This species already has a product listing.');
            }
            if (!String(data['sourceSpeciesId'] || '').trim() &&
                this.normalizedSpeciesName(String(data['name'] || '')) ===
                    this.normalizedSpeciesName(species.name)) {
                throw new Error('An older unlinked product has this species name. ' +
                    'Review its sourceSpeciesId before adding a new listing.');
            }
        }
    }
    // =========================================
    // SAVE PRODUCT
    // =========================================
    async saveProduct(): Promise<void> {
        if (this.saving)
            return;
        this.formError = this.validateForm();
        if (this.formError)
            return;
        if (!this.currentUserId ||
            this.auth.currentUser?.uid !== this.currentUserId) {
            this.formError = 'Please sign in before saving a product.';
            return;
        }
        const form = this.productForm;
        const colorStocks: ProductColorStock[] = this.canManageProductColors()
            ? form.colorStocks.map(color => ({
                name: color.name,
                quantity: Number(color.quantity),
                lowStockThreshold: Number(color.lowStockThreshold ?? 0)
            }))
            : [];
        const newSilkworm = !this.editingProductId &&
            form.category === 'Silkworms';
        const totalStock = newSilkworm
            ? 0 // Replaced with the live species stock inside the transaction.
            : colorStocks.length
                ? colorStocks.reduce((sum, color) => sum + color.quantity, 0)
                : Number(form.stock);
        if (!Number.isSafeInteger(totalStock) || totalStock < 0 ||
            totalStock > 100000000) {
            this.formError = 'Invalid product stock quantity.';
            return;
        }
        const data = {
            name: form.name.trim(),
            category: form.category,
            description: form.description.trim(),
            price: Number(form.price),
            stock: totalStock,
            lowStockThreshold: Number(form.lowStockThreshold),
            colorStocks,
            imageUrl: form.imageUrl.trim(),
            published: form.published,
            featured: form.featured
        };
        const sessionUserId = this.currentUserId;
        this.saving = true;
        this.refresh();
        try {
            if (this.editingProductId) {
                const productId = this.editingProductId;
                const original = this.originalEditingProduct;
                if (!original) {
                    throw new Error('Please reopen this product before editing.');
                }
                const activityReference = this.inContext(() => doc(collection(this.firestore, 'inventory_activity')));
                await this.inContext(() => runTransaction(this.firestore, async (transaction) => {
                    const reference = doc(this.firestore, 'products', productId);
                    const snapshot = await transaction.get(reference);
                    if (!snapshot.exists())
                        throw new Error('This product no longer exists.');
                    const current = this.normalizeProduct({
                        ...snapshot.data(), id: productId
                    });
                    if (current.sourceSpeciesId !== original.sourceSpeciesId) {
                        throw new Error('The linked species changed. Reopen this product.');
                    }
                    if (current.category !== original.category) {
                        throw new Error('The product category changed. Reopen this product.');
                    }
                    if (current.sourceSpeciesId && data.category !== 'Silkworms') {
                        throw new Error('Linked silkworm products must remain Silkworms.');
                    }
                    if (!current.sourceSpeciesId && data.category === 'Silkworms' &&
                        current.category !== 'Silkworms') {
                        throw new Error('Select an original species when creating a silkworm product.');
                    }
                    const userChangedQuantity = totalStock !== original.stock ||
                        !this.quantitiesEqual(colorStocks, original.colorStocks);
                    const remoteChangedQuantity = current.stock !== original.stock ||
                        !this.quantitiesEqual(current.colorStocks, original.colorStocks);
                    if (userChangedQuantity && remoteChangedQuantity) {
                        throw new Error('Product stock changed while editing. Reopen the product to ' +
                            'avoid overwriting a customer order or a staff stock update.');
                    }
                    if (current.category === 'Silkworms' &&
                        !current.sourceSpeciesId && userChangedQuantity) {
                        throw new Error('This older silkworm product has no sourceSpeciesId. ' +
                            'Resolve its link before adjusting its stock; other product ' +
                            'information can still be edited.');
                    }
                    const thresholdChanged = !this.thresholdsEqual(colorStocks, original.colorStocks);
                    const mergedColors = this.mergeColorThresholds(original.colorStocks, colorStocks, current.colorStocks);
                    const stockThresholdChanged = data.lowStockThreshold !== original.lowStockThreshold;
                    if (stockThresholdChanged &&
                        current.lowStockThreshold !== original.lowStockThreshold &&
                        current.lowStockThreshold !== data.lowStockThreshold) {
                        throw new Error('The low-stock threshold changed. Reopen the product.');
                    }
                    const updatedFields: Record<string, unknown> = {
                        name: data.name,
                        category: data.category,
                        description: data.description,
                        price: data.price,
                        imageUrl: data.imageUrl,
                        published: data.published,
                        featured: data.featured,
                        updatedAt: serverTimestamp()
                    };
                    if (stockThresholdChanged) {
                        updatedFields['lowStockThreshold'] = data.lowStockThreshold;
                    }
                    let sourceReference: ReturnType<typeof doc> | null = null;
                    let previousSpeciesQuantity = 0;
                    if (current.sourceSpeciesId) {
                        sourceReference = doc(this.firestore, 'inventory_species', current.sourceSpeciesId);
                        const speciesSnapshot = await transaction.get(sourceReference);
                        if (!speciesSnapshot.exists()) {
                            throw new Error('Linked species inventory no longer exists.');
                        }
                        previousSpeciesQuantity = Number(speciesSnapshot.data()?.['quantity']);
                        if (!this.validWholeNumber(previousSpeciesQuantity)) {
                            throw new Error('Linked species inventory contains invalid stock.');
                        }
                        const originalSpeciesThreshold = Number(speciesSnapshot.data()?.['threshold']);
                        if (!this.validWholeNumber(originalSpeciesThreshold)) {
                            throw new Error('Linked species has an invalid low-stock threshold.');
                        }
                        if (stockThresholdChanged &&
                            originalSpeciesThreshold !== original.lowStockThreshold &&
                            originalSpeciesThreshold !== data.lowStockThreshold) {
                            throw new Error('The species and product have different low-stock thresholds. ' +
                                'Review Inventory Management before changing this threshold.');
                        }
                        if (userChangedQuantity && current.stock !== previousSpeciesQuantity) {
                            throw new Error(`Species has ${previousSpeciesQuantity} worms, product has ${current.stock}. ` +
                                'Reconcile these quantities in Inventory Management before editing stock.');
                        }
                    }
                    if (userChangedQuantity) {
                        updatedFields['stock'] = totalStock;
                        updatedFields['colorStocks'] = colorStocks;
                    }
                    else if (thresholdChanged) {
                        updatedFields['colorStocks'] = mergedColors;
                    }
                    // Every document read is complete before the first write.
                    transaction.update(reference, updatedFields);
                    if (sourceReference && (userChangedQuantity || stockThresholdChanged)) {
                        transaction.update(sourceReference, {
                            ...(userChangedQuantity ? { quantity: totalStock } : {}),
                            ...(stockThresholdChanged
                                ? { threshold: data.lowStockThreshold }
                                : {}),
                            updatedAt: serverTimestamp(),
                            updatedBy: sessionUserId
                        });
                    }
                    if (sourceReference && userChangedQuantity) {
                        transaction.set(activityReference, {
                            message: 'Silkworm stock adjusted',
                            detail: `${data.name}: ${previousSpeciesQuantity} → ${totalStock} worms (Product Management and linked species)`,
                            type: 'stock',
                            actorUid: sessionUserId,
                            createdAt: serverTimestamp(),
                            productionDelta: {
                                silkworms: Math.max(0, totalStock - previousSpeciesQuantity),
                                products: 0,
                                cocoons: 0
                            }
                        });
                    }
                }));
            }
            else {
                const chosenSpecies = newSilkworm
                    ? await this.resolveSpeciesForNewProduct(data.name)
                    : null;
                if (newSilkworm && !chosenSpecies)
                    return;
                const reference = this.inContext(() => chosenSpecies
                    ? doc(this.firestore, 'products', chosenSpecies.id)
                    : doc(this.productCollection));
                if (chosenSpecies) {
                    await this.assertSpeciesNotListed(chosenSpecies);
                    const activityReference = this.inContext(() => doc(collection(this.firestore, 'inventory_activity')));
                    let createdStock = 0;
                    let createdThreshold = data.lowStockThreshold;
                    await this.inContext(() => runTransaction(this.firestore, async (transaction) => {
                        const speciesReference = doc(this.firestore, 'inventory_species', chosenSpecies.id);
                        const speciesSnapshot = await transaction.get(speciesReference);
                        const productSnapshot = await transaction.get(reference);
                        if (!speciesSnapshot.exists()) {
                            throw new Error('Selected species no longer exists.');
                        }
                        if (productSnapshot.exists()) {
                            throw new Error('This species already has a product listing.');
                        }
                        const source = speciesSnapshot.data() || {};
                        const speciesName = String(source['name'] || '').trim();
                        const available = Number(source['quantity']);
                        if (speciesName !== chosenSpecies.name) {
                            throw new Error('Species name changed. Reopen Product Management.');
                        }
                        if (!this.validWholeNumber(available) || available > 100000000) {
                            throw new Error('Selected species has invalid stock.');
                        }
                        createdStock = available;
                        const threshold = Number(source['threshold'] ?? 10);
                        if (!this.validWholeNumber(threshold) || threshold > 100000000) {
                            throw new Error('Selected species has an invalid threshold.');
                        }
                        createdThreshold = threshold;
                        transaction.set(reference, {
                            ...data,
                            stock: available,
                            lowStockThreshold: threshold,
                            colorStocks: [],
                            id: reference.id,
                            sourceSpeciesId: chosenSpecies.id,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        });
                        transaction.set(activityReference, {
                            message: 'Silkworm added to Product Management',
                            detail: `${data.name} — ${available} shared worms at ₱${data.price.toFixed(2)} each`,
                            type: 'add',
                            actorUid: sessionUserId,
                            createdAt: serverTimestamp()
                        });
                    }));
                    this.selectedProduct = {
                        ...data,
                        stock: createdStock,
                        lowStockThreshold: createdThreshold,
                        colorStocks: [],
                        sourceSpeciesId: chosenSpecies.id,
                        id: reference.id,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };
                }
                else {
                    // All other product categories retain their original behavior.
                    await this.inContext(() => setDoc(reference, {
                        ...data,
                        id: reference.id,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    }));
                    this.selectedProduct = {
                        ...data,
                        id: reference.id,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };
                }
            }
            if (sessionUserId !== this.currentUserId)
                return;
            this.showProductModal = false;
            this.editingProductId = null;
            this.originalEditingProduct = null;
            this.formError = '';
            await Swal.fire({
                icon: 'success',
                title: 'Product Saved',
                text: data.published
                    ? 'The product information has been updated.'
                    : 'Your product has been saved as a draft.',
                confirmButtonColor: '#287457',
                timer: 1700,
                showConfirmButton: false
            });
        }
        catch (error: any) {
            console.error('Product save failed:', error);
            this.formError = error?.code === 'permission-denied'
                ? 'Firebase denied this action. Check your Staff/Admin permissions and Firestore rules.'
                : error?.message || 'Unable to save the product.';
        }
        finally {
            this.saving = false;
            this.refresh();
        }
    }
    // =========================================
    // PUBLISH / UNPUBLISH
    // =========================================
    async togglePublish(product: ShopProduct): Promise<void> {
        if (this.saving)
            return;
        const publish = !product.published;
        if (publish &&
            product.stock <= 0) {
            await Swal.fire({
                icon: 'warning',
                title: 'Out of Stock',
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
        if (!result.isConfirmed)
            return;
        this.saving = true;
        this.refresh();
        try {
            await this.inContext(() => runTransaction(this.firestore, async (transaction) => {
                const reference = doc(this.firestore, 'products', product.id);
                const snapshot = await transaction.get(reference);
                if (!snapshot.exists()) {
                    throw new Error('Product no longer exists.');
                }
                const current = snapshot.data() || {};
                if (current['published'] === publish) {
                    throw new Error('The publication status changed. Refresh the product.');
                }
                if (publish) {
                    const sourceId = String(current['sourceSpeciesId'] || '').trim();
                    if (String(current['category'] || '') === 'Silkworms') {
                        if (!sourceId) {
                            throw new Error('An older silkworm product needs a verified species link before publishing.');
                        }
                        const speciesRef = doc(this.firestore, 'inventory_species', sourceId);
                        const speciesSnapshot = await transaction.get(speciesRef);
                        if (!speciesSnapshot.exists()) {
                            throw new Error('Original species inventory is missing.');
                        }
                        if (Number(speciesSnapshot.data()?.['quantity']) !==
                            Number(current['stock'])) {
                            throw new Error('Species and product quantities differ. Reconcile in ' +
                                'Inventory Management before publishing.');
                        }
                    }
                    if (Number(current['stock'] || 0) <= 0) {
                        throw new Error('This product is now out of stock.');
                    }
                }
                transaction.update(reference, {
                    published: publish,
                    updatedAt: serverTimestamp()
                });
            }));
        }
        catch (error: any) {
            await Swal.fire({
                icon: 'error',
                title: 'Unable to Update Product',
                text: error?.message ||
                    'Please try again.',
                confirmButtonColor: '#287457'
            });
        }
        finally {
            this.saving = false;
            this.refresh();
        }
    }
    // =========================================
    // DELETE UNUSED PRODUCT LISTINGS
    // =========================================

    // A product used by an order must remain available for order history.
    // Older orders may have no productId, so use their item name/category
    // as a conservative fallback. This only reads order documents.
    private async findOrdersUsingProduct(
        product: Pick<ShopProduct, 'id' | 'name' | 'category' | 'sourceSpeciesId'>
    ): Promise<string[]> {
        const snapshot = await getDocsFromServer(
            collection(this.firestore, 'orders')
        );

        const matches: string[] = [];
        const targetName = product.name.trim().toLocaleLowerCase();
        const targetCategory = product.category.trim().toLocaleLowerCase();
        const targetSpecies = String(product.sourceSpeciesId || '').trim();

        for (const entry of snapshot.docs) {
            const order = entry.data();
            const items: any[] = Array.isArray(order['items'])
                ? order['items']
                : [];

            const used = items.some(item => {
                const orderedProductId = String(item?.productId || '').trim();
                const orderedSpeciesId = String(item?.sourceSpeciesId || '').trim();
                const orderedName = String(item?.name || '')
                    .trim().toLocaleLowerCase();
                const orderedCategory = String(item?.category || '')
                    .trim().toLocaleLowerCase();

                if (orderedProductId === product.id) {
                    return true;
                }

                if (
                    targetSpecies &&
                    orderedSpeciesId === targetSpecies &&
                    (!orderedProductId || orderedProductId === product.id)
                ) {
                    return true;
                }

                // Only use name matching if a historical order has no
                // product ID; avoid confusing two different known IDs.
                return !orderedProductId &&
                    orderedName === targetName &&
                    (orderedCategory === targetCategory || !orderedCategory);
            });

            if (used) matches.push(entry.id);
        }

        return matches;
    }

    // Remove publication first so new customer checkout transactions
    // cannot successfully order this listing during deletion.
    private async unpublishProductBeforeRemoval(
        product: ShopProduct
    ): Promise<void> {
        await runTransaction(this.firestore, async transaction => {
            const reference = doc(this.firestore, 'products', product.id);
            const snapshot = await transaction.get(reference);

            if (!snapshot.exists()) {
                throw new Error('Product no longer exists. Refresh the list.');
            }

            const latest = snapshot.data() || {};
            const sourceId = String(latest['sourceSpeciesId'] || '').trim();
            const expectedSourceId = String(product.sourceSpeciesId || '').trim();

            if (
                sourceId !== expectedSourceId ||
                String(latest['category'] || '') !== product.category ||
                String(latest['name'] || '') !== product.name
            ) {
                throw new Error('Product information changed. Refresh and try again.');
            }

            if (latest['everOrdered'] === true) {
                throw new Error(
                    'This product has delivery history. Keep it for historical records; unpublish it instead.'
                );
            }

            if (latest['published'] === true) {
                transaction.update(reference, {
                    published: false,
                    updatedAt: serverTimestamp()
                });
            }
        });
    }

    async deleteProduct(product: ShopProduct): Promise<void> {
        if (this.saving) return;

        if (
            !this.currentUserId ||
            this.auth.currentUser?.uid !== this.currentUserId
        ) {
            await Swal.fire({
                icon: 'warning',
                title: 'Sign In Required',
                text: 'Sign in as Admin or Staff to delete a product.',
                confirmButtonColor: '#287457'
            });
            return;
        }

        const currentProduct = this.products.find(item => item.id === product.id);
        if (!currentProduct) {
            await Swal.fire({
                icon: 'warning',
                title: 'Product Not Found',
                text: 'Refresh Product Management and try again.',
                confirmButtonColor: '#287457'
            });
            return;
        }

        this.saving = true;
        this.refresh();

        try {
            // Do not delete if any customer order has ever used this product.
            const existingOrders = await this.inContext(() =>
                this.findOrdersUsingProduct(currentProduct)
            );

            if (existingOrders.length > 0) {
                throw new Error(
                    `This product is referenced by ${existingOrders.length} customer order(s). ` +
                    'It must remain for order history. You can unpublish the product instead.'
                );
            }

            this.saving = false;
            this.refresh();

            const confirmation = await Swal.fire({
                icon: 'warning',
                title: 'Permanently Delete Product?',
                text: currentProduct.sourceSpeciesId
                    ? `Delete "${currentProduct.name}" from Product Management? ` +
                      'Its original silkworm species and stock will remain unchanged. This cannot be undone.'
                    : `Permanently delete "${currentProduct.name}"? ` +
                      'Its product stock record will be removed. This cannot be undone.',
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
                // Step 1: stop new checkout attempts.
                await this.unpublishProductBeforeRemoval(currentProduct);

                // Step 2: re-read order history from the server after
                // unpublishing, including orders created moments ago.
                const latestOrders = await this.findOrdersUsingProduct(currentProduct);
                if (latestOrders.length > 0) {
                    throw new Error(
                        'A customer order now references this product. It was unpublished ' +
                        'to prevent further orders, but its record was not deleted.'
                    );
                }

                // Step 3: delete only the product and record the action.
                // Do not change inventory_species or any customer orders.
                const reference = doc(this.firestore, 'products', currentProduct.id);
                const activityReference = doc(
                    collection(this.firestore, 'inventory_activity')
                );

                await runTransaction(this.firestore, async transaction => {
                    const snapshot = await transaction.get(reference);

                    if (!snapshot.exists()) {
                        throw new Error('Product was already deleted. Refresh the list.');
                    }

                    const latest = snapshot.data() || {};
                    if (
                        String(latest['sourceSpeciesId'] || '').trim() !==
                            String(currentProduct.sourceSpeciesId || '').trim() ||
                        String(latest['name'] || '') !== currentProduct.name ||
                        String(latest['category'] || '') !== currentProduct.category ||
                        latest['published'] === true ||
                        latest['everOrdered'] === true
                    ) {
                        throw new Error(
                            'Product was changed or has order history. Refresh and try again.'
                        );
                    }

                    transaction.delete(reference);
                    transaction.set(activityReference, {
                        message: 'Silk product permanently deleted',
                        detail: currentProduct.sourceSpeciesId
                            ? `${currentProduct.name} — listing deleted; original species stock preserved`
                            : `${currentProduct.name} — independent product listing deleted`,
                        type: 'remove',
                        actorUid: this.currentUserId,
                        createdAt: serverTimestamp()
                    });
                });
            });

            if (this.selectedProduct?.id === currentProduct.id) {
                this.selectedProduct = null;
                this.showAllSelectedColors = false;
            }

            await Swal.fire({
                icon: 'success',
                title: 'Product Deleted',
                text: currentProduct.sourceSpeciesId
                    ? 'The product listing was deleted. Its species stock was not changed.'
                    : 'The product was permanently deleted.',
                confirmButtonColor: '#287457',
                timer: 1700,
                showConfirmButton: false
            });
        } catch (error: any) {
            console.error('Product deletion failed:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Unable to Delete Product',
                text: error?.code === 'permission-denied'
                    ? 'Firestore denied deletion. Check the published Admin/Staff delete rules.'
                    : error?.message || 'Product could not be deleted.',
                confirmButtonColor: '#287457'
            });
        } finally {
            this.saving = false;
            this.refresh();
        }
    }
    // =========================================
    // STATUS DISPLAY
    // =========================================
    getStatusText(product: ShopProduct): string {
        if (product.stock <= 0) {
            return 'Out of Stock';
        }
        if (this.isLowStock(product)) {
            return 'Low Stock';
        }
        return product.published
            ? 'Published'
            : 'Draft';
    }
    getStatusClass(product: ShopProduct): string {
        if (product.stock <= 0) {
            return 'status-out';
        }
        if (this.isLowStock(product)) {
            return 'status-low';
        }
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
    // =========================================
    // DATE HELPERS
    // =========================================
    private toMillis(value: any): number {
        if (!value)
            return 0;
        if (typeof value.toMillis === 'function') {
            return value.toMillis();
        }
        if (typeof value.seconds === 'number') {
            return value.seconds * 1000;
        }
        const millis = new Date(value).getTime();
        return Number.isFinite(millis)
            ? millis
            : 0;
    }
    formatDate(value: any): string {
        const millis = this.toMillis(value);
        if (!millis) {
            return 'Just now';
        }
        return new Date(millis).toLocaleString('en-PH', {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    }
}
