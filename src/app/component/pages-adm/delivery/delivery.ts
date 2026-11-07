
import { CommonModule, DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Inject,
  Injector,
  NgZone,
  OnDestroy,
  OnInit,
  Renderer2,
  ViewChild,
  runInInjectionContext
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  runTransaction,
  serverTimestamp
} from '@angular/fire/firestore';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

import {
  OrderServ,
  SilkMartOrder
} from '../../../services/order.serv';

type DeliveryStatus =
  | 'Pending'
  | 'Ready to Schedule'
  | 'Scheduled'
  | 'Preparing'
  | 'Out for Delivery'
  | 'Delivered'
  | 'Cancelled';

interface DeliveryPreparation {
  quantityChecked: boolean;
  packagingChecked: boolean;
  handlingChecked: boolean;
}

interface DeliveryOrder {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  items: {
    name: string;
    quantity: number;
  }[];
  total: number;
  orderStatus: string;
  deliveryStatus: DeliveryStatus;
  preferredDate: string;
  scheduledDate: string;
  deliveryArea: string;
  timeSlot: string;
  notes: string;
  preparation: DeliveryPreparation;
}

type DeliveryAction =
  | 'schedule'
  | 'prepare'
  | 'dispatch'
  | 'deliver';

@Component({
  selector: 'app-delivery',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './delivery.html',
  styleUrl: './delivery.scss'
})
export class Delivery
  implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('deliveryOverlay', { static: true })
  deliveryOverlay!: ElementRef<HTMLElement>;

  orders: DeliveryOrder[] = [];

  loading = true;
  error = '';
  saving = false;

  search = '';
  filter: DeliveryStatus | 'All' = 'All';
  areaFilter = 'All Areas';

  selectedOrder: DeliveryOrder | null = null;
  showEditor = false;

  editDate = '';
  editTimeSlot = '8:00 AM - 12:00 PM';
  editArea = '';
  editNotes = '';

  prepQuantity = false;
  prepPackaging = false;
  prepHandling = false;

  today = this.localDate(new Date());
  displayedMonth = new Date();
  selectedCalendarDate = this.today;

  readonly statuses: (DeliveryStatus | 'All')[] = [
    'All',
    'Pending',
    'Ready to Schedule',
    'Scheduled',
    'Preparing',
    'Out for Delivery',
    'Delivered',
    'Cancelled'
  ];

  readonly timeSlots = [
    '8:00 AM - 12:00 PM',
    '1:00 PM - 5:00 PM',
    'Flexible / To be confirmed'
  ];

  private subscription: Subscription | null = null;
  private previousBodyOverflow = '';
  private bodyLocked = false;
  private destroyed = false;

  constructor(
    private ordersService: OrderServ,
    private auth: Auth,
    private firestore: Firestore,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document
  ) {}

  ngOnInit(): void {
    this.destroyed = false;
    this.loadOrders();
  }

  ngAfterViewInit(): void {
    this.renderer.appendChild(
      this.document.body,
      this.deliveryOverlay.nativeElement
    );
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.subscription?.unsubscribe();
    this.subscription = null;

    this.unlockBody();

    if (this.deliveryOverlay?.nativeElement?.parentNode) {
      this.renderer.removeChild(
        this.deliveryOverlay.nativeElement.parentNode,
        this.deliveryOverlay.nativeElement
      );
    }
  }

  private refresh(): void {
    if (!this.destroyed) {
      this.cdr.detectChanges();
    }
  }

  private lockBody(): void {
    if (this.bodyLocked) return;

    this.previousBodyOverflow =
      this.document.body.style.overflow;

    this.renderer.setStyle(
      this.document.body,
      'overflow',
      'hidden'
    );

    this.bodyLocked = true;
  }

  private unlockBody(): void {
    if (!this.bodyLocked) return;

    if (this.previousBodyOverflow) {
      this.renderer.setStyle(
        this.document.body,
        'overflow',
        this.previousBodyOverflow
      );
    } else {
      this.renderer.removeStyle(
        this.document.body,
        'overflow'
      );
    }

    this.bodyLocked = false;
  }

  // =========================================
  // REAL-TIME ORDER LIST
  // =========================================

  loadOrders(): void {
    this.subscription?.unsubscribe();

    this.loading = true;
    this.error = '';

    this.subscription = runInInjectionContext(
      this.injector,
      () => this.ordersService.getAllOrders().subscribe({
        next: (data: SilkMartOrder[]) => {
          this.zone.run(() => {
            if (this.destroyed) return;

            this.orders = data.map(item =>
              this.mapOrder(item)
            );

            if (this.selectedOrder && !this.saving) {
              const updated = this.orders.find(
                item => item.id === this.selectedOrder?.id
              );

              if (updated) {
                this.selectedOrder = updated;

                if (!this.showEditor) {
                  this.populateEditor(updated);
                }
              } else {
                this.closeEditor();
              }
            }

            this.loading = false;
            this.error = '';
            this.refresh();
          });
        },

        error: (err: any) => {
          this.zone.run(() => {
            if (this.destroyed) return;

            console.error('Delivery load error:', err);

            this.loading = false;
            this.error =
              err?.code === 'permission-denied'
                ? 'Your account is not authorized to view orders.'
                : 'Unable to load delivery records from Firebase.';

            this.refresh();
          });
        }
      })
    );
  }

  // =========================================
  // MAP FIRESTORE ORDER
  // =========================================

  private mapOrder(
    source: SilkMartOrder
  ): DeliveryOrder {
    const raw = source as SilkMartOrder & {
      deliveryStatus?: string;
      scheduledDeliveryDate?: string;
      deliveryArea?: string;
      deliveryTimeSlot?: string;
      deliveryNotes?: string;
      deliveryPreparation?: Partial<DeliveryPreparation>;
    };

    const orderStatus = String(
      source.status || 'Pending'
    );

    const savedDeliveryStatus = String(
      raw.deliveryStatus || ''
    );

    let deliveryStatus: DeliveryStatus = 'Pending';

    if (
      orderStatus === 'Cancelled' ||
      orderStatus === 'Rejected'
    ) {
      deliveryStatus = 'Cancelled';

    } else if (orderStatus === 'Delivered') {
      deliveryStatus = 'Delivered';

    } else if (orderStatus === 'Confirmed') {
      if (
        savedDeliveryStatus === 'Scheduled' ||
        savedDeliveryStatus === 'Preparing' ||
        savedDeliveryStatus === 'Out for Delivery'
      ) {
        deliveryStatus =
          savedDeliveryStatus as DeliveryStatus;
      } else {
        deliveryStatus = 'Ready to Schedule';
      }
    }

    const address =
      source.customer?.address || '';

    return {
      id: String(source.id),
      customerName:
        source.customer?.name || 'Unknown Customer',
      phone: source.customer?.phone || '',
      address,

      items: (source.items || []).map(item => ({
        name: item.name || 'Product',
        quantity: Number(item.quantity || 0)
      })),

      total: Number(source.total || 0),
      orderStatus,
      deliveryStatus,
      preferredDate:
        source.preferredDeliveryDate || '',
      scheduledDate:
        raw.scheduledDeliveryDate || '',
      deliveryArea:
        raw.deliveryArea || this.detectArea(address),
      timeSlot:
        raw.deliveryTimeSlot || '',
      notes:
        raw.deliveryNotes || '',
      preparation: {
        quantityChecked:
          !!raw.deliveryPreparation?.quantityChecked,
        packagingChecked:
          !!raw.deliveryPreparation?.packagingChecked,
        handlingChecked:
          !!raw.deliveryPreparation?.handlingChecked
      }
    };
  }

  private detectArea(address: string): string {
    const value = address.toLowerCase();

    if (value.includes('cagayan de oro')) {
      return 'Cagayan de Oro';
    }
    if (value.includes('claveria')) {
      return 'Claveria';
    }
    if (value.includes('gingoog')) {
      return 'Gingoog';
    }
    if (value.includes('bukidnon')) {
      return 'Bukidnon';
    }
    if (value.includes('villanueva')) {
      return 'Villanueva';
    }

    return 'Other Areas';
  }

  // =========================================
  // FILTERS AND SUMMARY
  // =========================================

  get availableAreas(): string[] {
    return [
      'All Areas',
      ...Array.from(
        new Set(this.orders.map(
          order => order.deliveryArea
        ))
      ).sort()
    ];
  }

  get filteredOrders(): DeliveryOrder[] {
    const query = this.search.trim().toLowerCase();

    return this.orders.filter(order => {
      const matchesSearch = !query || [
        order.id,
        order.customerName,
        order.address,
        order.deliveryArea,
        ...order.items.map(item => item.name)
      ].some(value =>
        value.toLowerCase().includes(query)
      );

      const matchesStatus =
        this.filter === 'All' ||
        order.deliveryStatus === this.filter;

      const matchesArea =
        this.areaFilter === 'All Areas' ||
        order.deliveryArea === this.areaFilter;

      return matchesSearch &&
        matchesStatus &&
        matchesArea;
    }).sort((a, b) =>
      (a.scheduledDate || a.preferredDate || '9999')
        .localeCompare(
          b.scheduledDate || b.preferredDate || '9999'
        )
    );
  }

  count(status: DeliveryStatus): number {
    return this.orders.filter(
      order => order.deliveryStatus === status
    ).length;
  }

  get pendingCount(): number {
    return this.count('Pending');
  }

  get readyCount(): number {
    return this.count('Ready to Schedule');
  }

  get awaitingCount(): number {
    return this.pendingCount + this.readyCount;
  }

  get scheduledCount(): number {
    return this.count('Scheduled') +
      this.count('Preparing');
  }

  get outCount(): number {
    return this.count('Out for Delivery');
  }

  get deliveredCount(): number {
    return this.count('Delivered');
  }

  get todayOrders(): DeliveryOrder[] {
    return this.orders.filter(
      order =>
        order.scheduledDate === this.today &&
        order.deliveryStatus !== 'Cancelled'
    );
  }

  // =========================================
  // CALENDAR
  // =========================================

  get monthLabel(): string {
    return this.displayedMonth.toLocaleDateString(
      'en-PH',
      {
        month: 'long',
        year: 'numeric'
      }
    );
  }

  get calendarCells(): (string | null)[] {
    const year = this.displayedMonth.getFullYear();
    const month = this.displayedMonth.getMonth();

    const blanks = new Date(
      year,
      month,
      1
    ).getDay();

    const days = new Date(
      year,
      month + 1,
      0
    ).getDate();

    const cells: (string | null)[] =
      Array(blanks).fill(null);

    for (let day = 1; day <= days; day++) {
      cells.push(
        `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      );
    }

    return cells;
  }

  changeMonth(amount: number): void {
    this.displayedMonth = new Date(
      this.displayedMonth.getFullYear(),
      this.displayedMonth.getMonth() + amount,
      1
    );
  }

  selectCalendarDate(date: string): void {
    this.selectedCalendarDate = date;
  }

  deliveriesOn(date: string): number {
    return this.orders.filter(
      order =>
        order.scheduledDate === date &&
        order.deliveryStatus !== 'Cancelled'
    ).length;
  }

  get selectedDayOrders(): DeliveryOrder[] {
    return this.orders.filter(
      order =>
        order.scheduledDate === this.selectedCalendarDate &&
        order.deliveryStatus !== 'Cancelled'
    );
  }

  private localDate(date: Date): string {
    const year = date.getFullYear();

    const month = String(
      date.getMonth() + 1
    ).padStart(2, '0');

    const day = String(
      date.getDate()
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  formatDate(value: string): string {
    if (!value) return 'Not scheduled';

    const parts = value.split('-').map(Number);

    if (
      parts.length !== 3 ||
      parts.some(number => !Number.isFinite(number))
    ) {
      return value;
    }

    return new Date(
      parts[0],
      parts[1] - 1,
      parts[2]
    ).toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  getItemCount(order: DeliveryOrder): number {
    return order.items.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
  }

  // =========================================
  // EDITOR
  // =========================================

  isClosed(order: DeliveryOrder): boolean {
    return order.deliveryStatus === 'Cancelled' ||
      order.deliveryStatus === 'Delivered' ||
      order.orderStatus === 'Rejected' ||
      order.orderStatus === 'Cancelled' ||
      order.orderStatus === 'Delivered';
  }

  // =========================================
  // STAGE-BASED DELIVERY ACTIONS
  // =========================================
  // Exactly one workflow stage can be edited at a time.
  // Preparing is editable until all three checklist items are SAVED.
  // After that, only Dispatch is available.

  get canSaveSchedule(): boolean {
    const order = this.selectedOrder;
    return !!order && !this.saving &&
      order.orderStatus === 'Confirmed' &&
      order.deliveryStatus === 'Ready to Schedule';
  }

  get canEditPreparation(): boolean {
    const order = this.selectedOrder;
    if (!order || this.saving || order.orderStatus !== 'Confirmed') {
      return false;
    }

    if (order.deliveryStatus === 'Scheduled') {
      return true;
    }

    return order.deliveryStatus === 'Preparing' &&
      !this.isPreparationSavedComplete(order);
  }

  get canSavePreparation(): boolean {
    return this.canEditPreparation;
  }

  get canDispatch(): boolean {
    const order = this.selectedOrder;
    return !!order && !this.saving &&
      order.orderStatus === 'Confirmed' &&
      order.deliveryStatus === 'Preparing' &&
      this.isPreparationSavedComplete(order) &&
      this.prepQuantity && this.prepPackaging && this.prepHandling;
  }

  get canConfirmDelivered(): boolean {
    const order = this.selectedOrder;
    return !!order && !this.saving &&
      order.orderStatus === 'Confirmed' &&
      order.deliveryStatus === 'Out for Delivery';
  }

  private isPreparationSavedComplete(order: DeliveryOrder): boolean {
    return order.preparation.quantityChecked &&
      order.preparation.packagingChecked &&
      order.preparation.handlingChecked;
  }

  get deliveryStepHint(): string {
    const order = this.selectedOrder;
    if (!order) return '';
    if (order.deliveryStatus === 'Ready to Schedule') {
      return 'Next step: Save Delivery Schedule. All other actions are locked.';
    }
    if (order.deliveryStatus === 'Scheduled') {
      return 'Next step: Complete and save the Preparation Checklist.';
    }
    if (order.deliveryStatus === 'Preparing') {
      return this.isPreparationSavedComplete(order)
        ? 'Next step: Dispatch Order. The checklist has been saved.'
        : 'Next step: Finish and save all preparation checks.';
    }
    if (order.deliveryStatus === 'Out for Delivery') {
      return 'Next step: Confirm Delivered after the customer receives the order.';
    }
    if (order.deliveryStatus === 'Delivered') {
      return 'Delivery completed. No further actions are available.';
    }
    if (order.deliveryStatus === 'Pending') {
      return 'First confirm this order in Customer Orders.';
    }
    return 'This delivery is closed. No actions are available.';
  }

  private populateEditor(order: DeliveryOrder): void {
    this.editDate =
      order.scheduledDate || order.preferredDate;

    this.editTimeSlot =
      order.timeSlot || '8:00 AM - 12:00 PM';

    this.editArea = order.deliveryArea;
    this.editNotes = order.notes;

    this.prepQuantity =
      order.preparation.quantityChecked;

    this.prepPackaging =
      order.preparation.packagingChecked;

    this.prepHandling =
      order.preparation.handlingChecked;
  }

  openEditor(order: DeliveryOrder): void {
    if (this.saving) return;

    this.selectedOrder = order;
    this.populateEditor(order);

    this.showEditor = true;
    this.lockBody();
    this.refresh();
  }

  closeEditor(): void {
    if (this.saving) return;

    this.showEditor = false;
    this.selectedOrder = null;

    this.unlockBody();
    this.refresh();
  }

  // =========================================
  // INVENTORY VALIDATION
  // =========================================

  private validQuantity(
    value: unknown,
    label: string
  ): number {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      throw new Error(
        `Missing stock quantity for ${label}.`
      );
    }

    const quantity = Number(value);

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0
    ) {
      throw new Error(
        `Invalid stock quantity for ${label}.`
      );
    }

    return quantity;
  }

  // =========================================
  // DEDUCT INVENTORY ON SUCCESSFUL DELIVERY
  // =========================================

  private async deductOnSuccessfulDelivery(
    transaction: any,
    current: SilkMartOrder
  ): Promise<void> {

    // Older orders may have deducted stock during checkout.
    // Never deduct twice, even when a delivery is retried.
    if (current.stockDeducted === true) {
      if (current.stockRestored === true) {
        throw new Error(
          'This order has already had its stock restored.'
        );
      }
      return;
    }

    if (current.stockRestored === true) {
      throw new Error(
        'Invalid inventory state: stock was restored.'
      );
    }

    if (current.stockDeducted !== false ||
        Number(current.inventoryVersion) !== 2) {
      throw new Error(
        'This order has legacy or missing inventory markers. Review its stock history before delivery.'
      );
    }

    if (
      !Array.isArray(current.items) ||
      current.items.length === 0
    ) {
      throw new Error(
        'This order has no valid products.'
      );
    }

    const productTotals =
      new Map<string, number>();

    const colorTotals =
      new Map<string, Map<string, number>>();

    const speciesTotals =
      new Map<string, number>();

    // A silkworm species must have only one selling product.
    // Detect conflicting links within this order before any writes.
    const productBySpecies = new Map<string, string>();

    // Aggregate ordered quantities.

    for (const item of current.items) {
      const id = String(
        item.productId || ''
      ).trim();

      const colorName = String(
        item.selectedColor || ''
      ).trim();

      const quantity =
        this.validQuantity(
          item.quantity,
          item.name || 'product'
        );

      if (!id || quantity < 1) {
        throw new Error(
          'Order contains an invalid product ID or quantity.'
        );
      }

      const nextQuantity =
        (productTotals.get(id) || 0) +
        quantity;

      if (
        !Number.isSafeInteger(nextQuantity)
      ) {
        throw new Error(
          'Order quantity is too large.'
        );
      }

      productTotals.set(
        id,
        nextQuantity
      );

      if (colorName) {
        if (!colorTotals.has(id)) {
          colorTotals.set(
            id,
            new Map<string, number>()
          );
        }

        const perColor =
          colorTotals.get(id)!;

        const nextColorQuantity =
          (perColor.get(colorName) || 0) +
          quantity;

        if (
          !Number.isSafeInteger(nextColorQuantity)
        ) {
          throw new Error(
            'Order color quantity is too large.'
          );
        }

        perColor.set(
          colorName,
          nextColorQuantity
        );
      }
    }

    // =========================================
    // READ ALL PRODUCTS
    // =========================================

    const productDocuments = new Map<
      string,
      {
        ref: ReturnType<typeof doc>;
        data: Record<string, any>;
      }
    >();

    for (
      const productId
      of [...productTotals.keys()].sort()
    ) {
      const ref = doc(
        this.firestore,
        'products',
        productId
      );

      const snapshot =
        await transaction.get(ref);

      if (!snapshot.exists()) {
        throw new Error(
          'An ordered product no longer exists.'
        );
      }

      productDocuments.set(
        productId,
        {
          ref,
          data: snapshot.data()
        }
      );
    }

    // =========================================
    // RESOLVE LINKED SPECIES
    // =========================================

    for (
      const [productId, amount]
      of productTotals
    ) {
      const product =
        productDocuments.get(productId)!.data;

      const sourceId = String(
        product['sourceSpeciesId'] || ''
      ).trim();

      const category = String(
        product['category'] || ''
      ).trim().toLowerCase();

      // Never treat an unlinked silkworm listing as an
      // independent inventory during delivery.
      if (category === 'silkworms' && !sourceId) {
        throw new Error(
          `The silkworm product ${String(product['name'] || productId)} ` +
          'is missing its species link. Resolve the existing ' +
          'product record before completing delivery.'
        );
      }

      if (sourceId && category !== 'silkworms') {
        throw new Error(
          'A non-silkworm product has an invalid species link.'
        );
      }

      if (sourceId) {
        const otherProduct = productBySpecies.get(sourceId);
        if (otherProduct && otherProduct !== productId) {
          throw new Error(
            'Multiple ordered products point to one silkworm species. ' +
            'Review duplicate product listings before delivery.'
          );
        }
        productBySpecies.set(sourceId, productId);
      }

      const orderItems =
        current.items.filter(
          item =>
            String(
              item.productId || ''
            ).trim() === productId
        );

      for (const item of orderItems) {
        if (
          String(
            item.sourceSpeciesId || ''
          ).trim() !== sourceId
        ) {
          throw new Error(
            'This order has a missing or different species link. ' +
            'Review its original product and inventory history ' +
            'before completing delivery.'
          );
        }
      }

      if (sourceId) {
        const next =
          (speciesTotals.get(sourceId) || 0) +
          amount;

        if (!Number.isSafeInteger(next)) {
          throw new Error(
            'Species quantity is too large.'
          );
        }

        speciesTotals.set(
          sourceId,
          next
        );
      }
    }

    // =========================================
    // READ ALL SPECIES
    // =========================================

    const speciesDocuments = new Map<
      string,
      {
        ref: ReturnType<typeof doc>;
        data: Record<string, any>;
      }
    >();

    for (
      const speciesId
      of [...speciesTotals.keys()].sort()
    ) {
      const ref = doc(
        this.firestore,
        'inventory_species',
        speciesId
      );

      const snapshot =
        await transaction.get(ref);

      if (!snapshot.exists()) {
        throw new Error(
          'Linked silkworm inventory no longer exists.'
        );
      }

      speciesDocuments.set(
        speciesId,
        {
          ref,
          data: snapshot.data()
        }
      );
    }


    // =========================================
    // VALIDATE PRODUCT AND COLOR STOCK
    // =========================================

    const productUpdates =
      new Map<
        string,
        Record<string, unknown>
      >();

    for (
      const [productId, amount]
      of productTotals
    ) {
      const product =
        productDocuments.get(productId)!.data;

      const stock =
        this.validQuantity(
          product['stock'],
          productId
        );

      const sourceId = String(
        product['sourceSpeciesId'] || ''
      ).trim();

      // Species is the authoritative stock source.
      // Do not silently erase existing discrepancies.
      if (sourceId) {
        const source = speciesDocuments.get(sourceId);

        if (!source) {
          throw new Error(
            'Linked species inventory is missing.'
          );
        }

        const speciesStock = this.validQuantity(
          source.data['quantity'],
          sourceId
        );

        if (stock !== speciesStock) {
          throw new Error(
            `Stock mismatch for ${String(product['name'] || productId)}: ` +
            `species has ${speciesStock} worms, product has ${stock}. ` +
            'Review and reconcile these records in Inventory ' +
            'Management before marking this order Delivered.'
          );
        }
      }

      if (stock < amount) {
        throw new Error(
          `Not enough stock for ${String(product['name'] || productId)}. Available: ${stock}; ordered: ${amount}.`
        );
      }

      const colors = Array.isArray(
        product['colorStocks']
      )
        ? product['colorStocks'].map(
            (color: any) => ({ ...color })
          )
        : [];

      const category = String(
        product['category'] || ''
      ).toLowerCase();

      const colorRequired =
        colors.length > 0 &&
        category !== 'silkworms' &&
        category !== 'cocoons';

      const selected =
        colorTotals.get(productId) ||
        new Map<string, number>();

      if (colorRequired) {
        const selectedTotal = [
          ...selected.values()
        ].reduce(
          (sum, quantity) =>
            sum + quantity,
          0
        );

        if (selectedTotal !== amount) {
          throw new Error(
            `A selected color is missing for ${String(product['name'] || productId)}.`
          );
        }

        for (
          const [colorName, colorAmount]
          of selected
        ) {
          const color = colors.find(
            (entry: any) =>
              entry.name === colorName
          );

          if (!color) {
            throw new Error(
              `Color ${colorName} is no longer available.`
            );
          }

          const colorStock =
            this.validQuantity(
              color.quantity,
              colorName
            );

          if (
            colorStock < colorAmount
          ) {
            throw new Error(
              `Not enough ${colorName} stock. Available: ${colorStock}; ordered: ${colorAmount}.`
            );
          }

          color.quantity =
            colorStock - colorAmount;
        }
      } else if (selected.size > 0) {
        throw new Error(
          'Order contains a color not used by this product.'
        );
      }

      const fields:
        Record<string, unknown> = {
          // Linked products and species now start
          // from the same verified quantity.
          stock: stock - amount,
          updatedAt: serverTimestamp(),
          everOrdered: true
        };

      if (colorRequired) {
        fields['colorStocks'] = colors;
      }

      productUpdates.set(
        productId,
        fields
      );
    }

    // =========================================
    // VALIDATE LINKED SILKWORM STOCK
    // =========================================

    for (
      const [speciesId, amount]
      of speciesTotals
    ) {
      const data =
        speciesDocuments.get(speciesId)!.data;

      const stock =
        this.validQuantity(
          data['quantity'],
          speciesId
        );

      if (stock < amount) {
        throw new Error(
          `Insufficient silkworm stock. Available: ${stock}; ordered: ${amount}.`
        );
      }
    }

    // =========================================
    // APPLY ALL INVENTORY CHANGES
    // =========================================
    // All reads and validations are complete.
    // These changes commit together with
    // the final order status update.

    for (
      const [productId, fields]
      of productUpdates
    ) {
      transaction.update(
        productDocuments.get(productId)!.ref,
        fields
      );
    }

    for (
      const [speciesId, amount]
      of speciesTotals
    ) {
      const species =
        speciesDocuments.get(speciesId)!;

      const stock =
        this.validQuantity(
          species.data['quantity'],
          speciesId
        );

      transaction.update(
        species.ref,
        {
          quantity: stock - amount,
          updatedAt: serverTimestamp(),
          updatedBy:
            this.ordersServiceUserId()
        }
      );
    }
  }

  private ordersServiceUserId(): string {
    const user =
      this.auth.currentUser;

    if (!user) {
      throw new Error(
        'Sign in with an Admin or Staff account.'
      );
    }

    return user.uid;
  }

  // =========================================
  // SAFE FIRESTORE DELIVERY TRANSACTION
  // =========================================

  private async updateDelivery(
    order: DeliveryOrder,
    action: DeliveryAction,
    fields: Record<string, unknown> = {}
  ): Promise<void> {

    await runInInjectionContext(
      this.injector,
      () => runTransaction(
        this.firestore,
        async transaction => {
          const reference = doc(
            this.firestore,
            'orders',
            order.id
          );

          const snapshot =
            await transaction.get(reference);

          if (!snapshot.exists()) {
            throw new Error(
              'This order no longer exists.'
            );
          }

          const current = snapshot.data();

          const currentStatus = String(
            current['status'] || 'Pending'
          );

          const currentDeliveryStatus = String(
            current['deliveryStatus'] || ''
          );

          if (
            currentStatus !== 'Confirmed'
          ) {
            throw new Error(
              'Only confirmed orders can be managed for delivery. This order may have changed status.'
            );
          }

          const currentStage =
            currentDeliveryStatus ||
            'Ready to Schedule';

          // Scheduling is the only action allowed at Ready to Schedule.
          if (action === 'schedule') {
            if (currentStage !== 'Ready to Schedule') {
              throw new Error(
                'This order has already been scheduled. Refresh the order to view the next step.'
              );
            }
          }

          // Preparation requires a schedule.
          if (action === 'prepare') {
            if (
              currentStage !== 'Scheduled' &&
              currentStage !== 'Preparing'
            ) {
              throw new Error(
                'The order must be scheduled before saving preparation.'
              );
            }

            if (!current['scheduledDeliveryDate']) {
              throw new Error(
                'This order has no saved delivery schedule.'
              );
            }

            const saved = current['deliveryPreparation'] || {};
            if (
              currentStage === 'Preparing' &&
              saved.quantityChecked === true &&
              saved.packagingChecked === true &&
              saved.handlingChecked === true
            ) {
              throw new Error(
                'The preparation checklist is complete. Dispatch this order instead.'
              );
            }
          }

          // Dispatch requires a completed checklist.
          if (action === 'dispatch') {
            if (
              currentStage !== 'Preparing'
            ) {
              throw new Error(
                'Save the preparation checklist before dispatching this order.'
              );
            }

            const preparation =
              current['deliveryPreparation'] || {};

            if (
              preparation.quantityChecked !== true ||
              preparation.packagingChecked !== true ||
              preparation.handlingChecked !== true
            ) {
              throw new Error(
                'All saved preparation checklist items must be completed before dispatch.'
              );
            }

            if (!current['scheduledDeliveryDate']) {
              throw new Error(
                'A delivery schedule is required.'
              );
            }
          }

          // Final delivery requires dispatch.
          if (action === 'deliver') {
            if (
              currentStage !== 'Out for Delivery'
            ) {
              throw new Error(
                'The order must be Out for Delivery before it can be marked Delivered.'
              );
            }
          }

          const updates:
            Record<string, unknown> = {
              ...fields,
              deliveryUpdatedAt:
                serverTimestamp()
            };

          if (action === 'schedule') {
            updates['deliveryStatus'] =
              'Scheduled';
          }

          if (action === 'prepare') {
            updates['deliveryStatus'] =
              'Preparing';
          }

          if (action === 'dispatch') {
            updates['deliveryStatus'] =
              'Out for Delivery';

            updates['dispatchedAt'] =
              serverTimestamp();
          }

          if (action === 'deliver') {
            // Deduct stock in this same transaction.
            await this.deductOnSuccessfulDelivery(
              transaction,
              current as SilkMartOrder
            );

            updates['status'] =
              'Delivered';

            updates['deliveryStatus'] =
              'Delivered';

            updates['updatedAt'] =
              serverTimestamp();

            updates['deliveredAt'] =
              serverTimestamp();

            updates['stockDeducted'] =
              true;

            updates['stockRestored'] =
              false;

            // Preserve historical inventory version.
            updates['inventoryVersion'] =
              Number(
                current['inventoryVersion'] || 1
              );
          }

          transaction.update(
            reference,
            updates
          );
        }
      )
    );
  }

  // =========================================
  // DELIVERY SCHEDULE
  // =========================================

  async saveSchedule(): Promise<void> {
    const order = this.selectedOrder;

    if (!order || this.saving) return;

    if (!this.canSaveSchedule) {
      await this.showWarning(
        'Scheduling Locked',
        'Save Delivery Schedule is only available when the order is Ready to Schedule.'
      );
      return;
    }

    if (this.isClosed(order)) {
      await this.showWarning(
        'Unavailable',
        'This delivery is already closed.'
      );
      return;
    }

    if (order.orderStatus !== 'Confirmed') {
      await this.showWarning(
        'Order Not Confirmed',
        'Confirm this order in Customer Orders before scheduling delivery.'
      );
      return;
    }

    this.today = this.localDate(new Date());

    if (
      !this.editDate ||
      this.editDate < this.today
    ) {
      await this.showWarning(
        'Invalid Date',
        'Choose today or a future delivery date.'
      );
      return;
    }

    if (
      !this.timeSlots.includes(
        this.editTimeSlot
      )
    ) {
      await this.showWarning(
        'Invalid Time Slot',
        'Please choose a valid delivery time.'
      );
      return;
    }

    if (!this.editArea.trim()) {
      await this.showWarning(
        'Missing Delivery Area',
        'Please enter the delivery area.'
      );
      return;
    }

    if (
      this.editArea.trim().length > 120 ||
      this.editNotes.trim().length > 1000
    ) {
      await this.showWarning(
        'Invalid Delivery Details',
        'The delivery area or notes are too long.'
      );
      return;
    }

    this.saving = true;
    this.refresh();

    try {
      await this.updateDelivery(
        order,
        'schedule',
        {
          scheduledDeliveryDate:
            this.editDate,
          deliveryTimeSlot:
            this.editTimeSlot,
          deliveryArea:
            this.editArea.trim(),
          deliveryNotes:
            this.editNotes.trim()
        }
      );

      this.saving = false;
      this.closeEditor();

      await Swal.fire({
        icon: 'success',
        title: 'Delivery Scheduled',
        text: 'The schedule was saved in Firebase.',
        timer: 1600,
        showConfirmButton: false,
        heightAuto: false
      });

    } catch (error) {
      this.saving = false;
      await this.showSaveError(error);
    } finally {
      this.refresh();
    }
  }

  // =========================================
  // PREPARATION CHECKLIST
  // =========================================

  async savePreparation(): Promise<void> {
    const order = this.selectedOrder;

    if (!order || this.saving) return;

    if (!this.canSavePreparation) {
      await this.showWarning(
        'Preparation Locked',
        'The checklist can be saved only after scheduling and before dispatch is ready.'
      );
      return;
    }

    if (
      order.deliveryStatus !== 'Scheduled' &&
      order.deliveryStatus !== 'Preparing'
    ) {
      await this.showWarning(
        'Schedule Required',
        'Schedule the delivery before preparing it.'
      );
      return;
    }

    this.saving = true;
    this.refresh();

    try {
      await this.updateDelivery(
        order,
        'prepare',
        {
          deliveryPreparation: {
            quantityChecked:
              this.prepQuantity,
            packagingChecked:
              this.prepPackaging,
            handlingChecked:
              this.prepHandling
          }
        }
      );

      this.saving = false;
      this.closeEditor();

      await Swal.fire({
        icon: 'success',
        title: 'Checklist Saved',
        text: 'The preparation checklist was saved.',
        timer: 1400,
        showConfirmButton: false,
        heightAuto: false
      });

    } catch (error) {
      this.saving = false;
      await this.showSaveError(error);
    } finally {
      this.refresh();
    }
  }

  // =========================================
  // DISPATCH ORDER
  // =========================================

  async dispatch(): Promise<void> {
    const order = this.selectedOrder;

    if (!order || this.saving) return;

    if (!this.canDispatch) {
      await this.showEditorAlert(
        'Dispatch Locked',
        'Save all three preparation checks first. Dispatch becomes available only in the Preparing stage.'
      );
      return;
    }

    if (order.deliveryStatus !== 'Preparing') {
      await this.showEditorAlert(
        'Not Ready for Dispatch',
        'Schedule and prepare this order first.'
      );
      return;
    }

    if (
      !this.prepQuantity ||
      !this.prepPackaging ||
      !this.prepHandling
    ) {
      await this.showEditorAlert(
        'Incomplete Preparation',
        'Complete and save all preparation checklist items before dispatch.'
      );
      return;
    }

    this.hideEditorForAlert();

    const result = await Swal.fire({
      icon: 'question',
      title: 'Dispatch This Order?',
      text:
        `Mark order ${order.id} as Out for Delivery?`,
      showCancelButton: true,
      confirmButtonText:
        'Dispatch Order',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#287156',
      background: '#fbfaf4',
      heightAuto: false
    });

    if (!result.isConfirmed) {
      this.restoreEditorAfterAlert(order);
      return;
    }

    this.saving = true;
    this.refresh();

    try {
      await this.updateDelivery(
        order,
        'dispatch'
      );

      this.saving = false;
      this.closeEditor();

      await Swal.fire({
        icon: 'success',
        title: 'Order Dispatched',
        text: 'The order is now out for delivery.',
        timer: 1400,
        showConfirmButton: false,
        heightAuto: false
      });

    } catch (error) {
      this.saving = false;
      await this.showSaveError(error);
      this.restoreEditorAfterAlert(order);
    } finally {
      this.refresh();
    }
  }

  // =========================================
  // MARK DELIVERED
  // =========================================

  async markDelivered(): Promise<void> {
    const order = this.selectedOrder;

    if (!order || this.saving) return;

    if (!this.canConfirmDelivered) {
      await this.showEditorAlert(
        'Delivery Confirmation Locked',
        'Confirm Delivered is available only when the order is Out for Delivery.'
      );
      return;
    }

    if (
      order.orderStatus !== 'Confirmed' ||
      order.deliveryStatus !== 'Out for Delivery'
    ) {
      await this.showEditorAlert(
        'Not Dispatched',
        'Dispatch this confirmed order before marking it Delivered.'
      );
      return;
    }

    this.hideEditorForAlert();

    const result = await Swal.fire({
      icon: 'question',
      title: 'Confirm Delivery?',
      text:
        'Confirm that the customer received the order.',
      showCancelButton: true,
      confirmButtonText:
        'Confirm Delivered',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#287156',
      background: '#fbfaf4',
      heightAuto: false
    });

    if (!result.isConfirmed) {
      this.restoreEditorAfterAlert(order);
      return;
    }

    this.saving = true;
    this.refresh();

    try {
      await this.updateDelivery(
        order,
        'deliver'
      );

      this.saving = false;
      this.closeEditor();

      await Swal.fire({
        icon: 'success',
        title: 'Delivery Completed',
        text:
          'The order has been marked as Delivered.',
        timer: 1500,
        showConfirmButton: false,
        heightAuto: false
      });

    } catch (error) {
      this.saving = false;
      await this.showSaveError(error);
      this.restoreEditorAfterAlert(order);
    } finally {
      this.refresh();
    }
  }

  // =========================================
  // MODAL AND ERROR HELPERS
  // =========================================

  private hideEditorForAlert(): void {
    this.showEditor = false;
    this.unlockBody();
    this.refresh();
  }

  private restoreEditorAfterAlert(
    order: DeliveryOrder
  ): void {
    if (this.destroyed) return;

    const latest = this.orders.find(
      item => item.id === order.id
    );

    if (!latest) {
      this.selectedOrder = null;
      this.showEditor = false;
      this.unlockBody();
      this.refresh();
      return;
    }

    this.selectedOrder = latest;
    this.showEditor = true;
    this.lockBody();
    this.refresh();
  }

  private async showEditorAlert(
    title: string,
    message: string
  ): Promise<void> {
    const order = this.selectedOrder;

    this.hideEditorForAlert();

    await this.showWarning(
      title,
      message
    );

    if (order) {
      this.restoreEditorAfterAlert(order);
    }
  }

  private async showWarning(
    title: string,
    message: string
  ): Promise<void> {
    await Swal.fire({
      icon: 'warning',
      title,
      text: message,
      confirmButtonColor: '#287156',
      heightAuto: false
    });
  }

  private async showSaveError(
    error: unknown
  ): Promise<void> {
    console.error(
      'Delivery update failed:',
      error
    );

    const value = error as {
      code?: string;
      message?: string;
    };

    const text =
      value?.code === 'permission-denied'
        ? 'Firebase denied the update. Check your Admin/Staff permissions and Firestore rules.'
        : value?.message ||
          'The update failed. Check your connection and try again.';

    await Swal.fire({
      icon: 'error',
      title: 'Unable to Save',
      text,
      confirmButtonColor: '#287156',
      heightAuto: false
    });
  }
}
