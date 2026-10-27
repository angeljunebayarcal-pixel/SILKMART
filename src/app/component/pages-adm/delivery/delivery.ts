
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
import {
  Firestore,
  doc,
  updateDoc,
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
  preparation: {
    quantityChecked: boolean;
    packagingChecked: boolean;
    handlingChecked: boolean;
  };
}

@Component({
  selector: 'app-delivery',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './delivery.html',
  styleUrl: './delivery.scss'
})
export class Delivery implements OnInit, AfterViewInit, OnDestroy {
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

  constructor(
    private ordersService: OrderServ,
    private firestore: Firestore,
    private injector: Injector,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document
  ) {}

  ngOnInit(): void {
    this.loadOrders();
  }

  ngAfterViewInit(): void {
    // Move the overlay outside the dashboard layout.
    // This prevents transformed or scrolling parent
    // elements from shifting its fixed position.
    this.renderer.appendChild(
      this.document.body,
      this.deliveryOverlay.nativeElement
    );
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();

    this.unlockBody();

    if (this.deliveryOverlay?.nativeElement?.parentNode) {
      this.renderer.removeChild(
        this.deliveryOverlay.nativeElement.parentNode,
        this.deliveryOverlay.nativeElement
      );
    }
  }

  private refresh(): void {
    this.cdr.detectChanges();
  }

  private lockBody(): void {
    this.previousBodyOverflow =
      this.document.body.style.overflow;

    this.renderer.setStyle(
      this.document.body,
      'overflow',
      'hidden'
    );
  }

  private unlockBody(): void {
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
  }

  loadOrders(): void {
    this.subscription?.unsubscribe();

    this.loading = true;
    this.error = '';

    this.subscription = runInInjectionContext(
      this.injector,
      () => this.ordersService.getAllOrders().subscribe({
        next: (data: SilkMartOrder[]) => {
          this.zone.run(() => {
            this.orders = data.map(item => this.mapOrder(item));

            if (this.selectedOrder && !this.saving) {
              const updated = this.orders.find(
                item => item.id === this.selectedOrder?.id
              );

              if (updated) {
                this.selectedOrder = updated;
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
            console.error('Delivery load error:', err);

            this.loading = false;
            this.error = err?.code === 'permission-denied'
              ? 'Your account is not authorized to view orders.'
              : 'Unable to load delivery records from Firebase.';

            this.refresh();
          });
        }
      })
    );
  }

  private mapOrder(source: SilkMartOrder): DeliveryOrder {
    const raw = source as SilkMartOrder & {
      deliveryStatus?: string;
      scheduledDeliveryDate?: string;
      deliveryArea?: string;
      deliveryTimeSlot?: string;
      deliveryNotes?: string;
      deliveryPreparation?: {
        quantityChecked?: boolean;
        packagingChecked?: boolean;
        handlingChecked?: boolean;
      };
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
      // Confirmation means the order can be scheduled.
      // It does not mean delivery has already happened.

      if (
        savedDeliveryStatus === 'Scheduled' ||
        savedDeliveryStatus === 'Preparing' ||
        savedDeliveryStatus === 'Out for Delivery'
      ) {
        deliveryStatus = savedDeliveryStatus;
      } else {
        deliveryStatus = 'Ready to Schedule';
      }

    } else {
      deliveryStatus = 'Pending';
    }

    const address = source.customer?.address || '';

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

  get availableAreas(): string[] {
    return [
      'All Areas',
      ...Array.from(
        new Set(this.orders.map(o => o.deliveryArea))
      ).sort()
    ];
  }

  get filteredOrders(): DeliveryOrder[] {
    const q = this.search.trim().toLowerCase();

    return this.orders
      .filter(order => {
        const matchesSearch = !q || [
          order.id,
          order.customerName,
          order.address,
          order.deliveryArea,
          ...order.items.map(item => item.name)
        ].some(value =>
          value.toLowerCase().includes(q)
        );

        const matchesStatus =
          this.filter === 'All' ||
          order.deliveryStatus === this.filter;

        const matchesArea =
          this.areaFilter === 'All Areas' ||
          order.deliveryArea === this.areaFilter;

        return (
          matchesSearch &&
          matchesStatus &&
          matchesArea
        );
      })
      .sort((a, b) =>
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
    return (
      this.count('Scheduled') +
      this.count('Preparing')
    );
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

    const result: (string | null)[] =
      Array(blanks).fill(null);

    for (let day = 1; day <= days; day++) {
      result.push(
        `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      );
    }

    return result;
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
    if (!value) {
      return 'Not scheduled';
    }

    const parts = value.split('-').map(Number);

    if (
      parts.length !== 3 ||
      parts.some(n => !Number.isFinite(n))
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

  isClosed(order: DeliveryOrder): boolean {
    return (
      order.deliveryStatus === 'Cancelled' ||
      order.deliveryStatus === 'Delivered'
    );
  }

  openEditor(order: DeliveryOrder): void {
    if (this.saving) {
      return;
    }

    this.selectedOrder = order;

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

    this.showEditor = true;

    this.lockBody();
    this.refresh();
  }

  closeEditor(): void {
    if (this.saving) {
      return;
    }

    this.showEditor = false;
    this.selectedOrder = null;

    this.unlockBody();
  }

  private async saveFields(
    order: DeliveryOrder,
    fields: Record<string, unknown>
  ): Promise<void> {
    await updateDoc(
      doc(this.firestore, 'orders', order.id),
      {
        ...fields,
        deliveryUpdatedAt: serverTimestamp()
      }
    );
  }

  async saveSchedule(): Promise<void> {
    const order = this.selectedOrder;

    if (!order || this.saving) {
      return;
    }

    if (this.isClosed(order)) {
      await Swal.fire(
        'Unavailable',
        'This delivery is already closed.',
        'info'
      );
      return;
    }

    if (order.orderStatus !== 'Confirmed') {
      await Swal.fire({
        icon: 'warning',
        title: 'Order Not Confirmed',
        text:
          'Please confirm this order in Customer Orders before scheduling delivery.',
        confirmButtonColor: '#287156'
      });
      return;
    }

    if (!this.editDate || this.editDate < this.today) {
      await Swal.fire({
        icon: 'warning',
        title: 'Invalid Date',
        text:
          'Please choose today or a future delivery date.',
        confirmButtonColor: '#287156'
      });
      return;
    }

    if (!this.editArea.trim()) {
      await Swal.fire({
        icon: 'warning',
        title: 'Missing Delivery Area',
        text: 'Please enter the delivery area.',
        confirmButtonColor: '#287156'
      });
      return;
    }

    this.saving = true;

    try {
      await this.saveFields(order, {
        scheduledDeliveryDate: this.editDate,
        deliveryTimeSlot: this.editTimeSlot,
        deliveryArea: this.editArea.trim(),
        deliveryNotes: this.editNotes.trim(),
        deliveryStatus: 'Scheduled'
      });

      this.saving = false;
      this.closeEditor();

      await Swal.fire({
        icon: 'success',
        title: 'Delivery Scheduled',
        text: 'The schedule was saved in Firebase.',
        timer: 1600,
        showConfirmButton: false
      });
    } catch (error) {
      this.saving = false;
      await this.showSaveError(error);
    }
  }

  async savePreparation(): Promise<void> {
    const order = this.selectedOrder;

    if (!order || this.saving) {
      return;
    }

    if (
      order.deliveryStatus !== 'Scheduled' &&
      order.deliveryStatus !== 'Preparing'
    ) {
      await Swal.fire({
        icon: 'warning',
        title: 'Schedule Required',
        text: 'Schedule the delivery before preparing it.',
        confirmButtonColor: '#287156'
      });
      return;
    }

    this.saving = true;

    try {
      await this.saveFields(order, {
        deliveryPreparation: {
          quantityChecked: this.prepQuantity,
          packagingChecked: this.prepPackaging,
          handlingChecked: this.prepHandling
        },
        deliveryStatus: 'Preparing'
      });

      this.saving = false;
      this.closeEditor();

      await Swal.fire({
        icon: 'success',
        title: 'Checklist Saved',
        timer: 1400,
        showConfirmButton: false
      });
    } catch (error) {
      this.saving = false;
      await this.showSaveError(error);
    }
  }

  
async dispatch(): Promise<void> {
  const order = this.selectedOrder;

  if (!order || this.saving) {
    return;
  }

  if (
    order.deliveryStatus !== 'Scheduled' &&
    order.deliveryStatus !== 'Preparing'
  ) {
    this.showEditor = false;
    this.unlockBody();
    this.refresh();

    await Swal.fire({
      icon: 'warning',
      title: 'Not Ready for Dispatch',
      text: 'Schedule and prepare this order first.',
      confirmButtonColor: '#287156',
      heightAuto: false
    });

    this.showEditor = true;
    this.lockBody();
    this.refresh();
    return;
  }

  if (
    !this.prepQuantity ||
    !this.prepPackaging ||
    !this.prepHandling
  ) {
    this.showEditor = false;
    this.unlockBody();
    this.refresh();

    await Swal.fire({
      icon: 'warning',
      title: 'Incomplete Preparation',
      text: 'Complete all preparation checklist items before dispatch.',
      confirmButtonColor: '#287156',
      heightAuto: false
    });

    this.showEditor = true;
    this.lockBody();
    this.refresh();
    return;
  }

  // Hide Delivery Details before SweetAlert opens.
  this.showEditor = false;
  this.unlockBody();
  this.refresh();

  const result = await Swal.fire({
    icon: 'question',
    title: 'Dispatch This Order?',
    text: `Mark order ${order.id} as Out for Delivery?`,
    showCancelButton: true,
    confirmButtonText: 'Dispatch Order',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#287156',
    background: '#fbfaf4',
    heightAuto: false
  });

  if (!result.isConfirmed) {
    this.showEditor = true;
    this.lockBody();
    this.refresh();
    return;
  }

  this.saving = true;

  try {
    await this.saveFields(order, {
      deliveryStatus: 'Out for Delivery',
      deliveryPreparation: {
        quantityChecked: true,
        packagingChecked: true,
        handlingChecked: true
      },
      dispatchedAt: serverTimestamp()
    });

    this.saving = false;
    this.closeEditor();
    this.refresh();

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

    this.showEditor = true;
    this.lockBody();
    this.refresh();
  }
}


async markDelivered(): Promise<void> {
  const order = this.selectedOrder;

  if (!order || this.saving) {
    return;
  }

  if (order.deliveryStatus !== 'Out for Delivery') {
    this.showEditor = false;
    this.unlockBody();
    this.refresh();

    await Swal.fire({
      icon: 'warning',
      title: 'Not Dispatched',
      text: 'Dispatch this order before marking it delivered.',
      confirmButtonColor: '#287156',
      heightAuto: false
    });

    this.showEditor = true;
    this.lockBody();
    this.refresh();
    return;
  }

  // Hide Delivery Details before confirmation.
  this.showEditor = false;
  this.unlockBody();
  this.refresh();

  const result = await Swal.fire({
    icon: 'question',
    title: 'Confirm Delivery?',
    text: 'Confirm that the customer received the order.',
    showCancelButton: true,
    confirmButtonText: 'Confirm Delivered',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#287156',
    background: '#fbfaf4',
    heightAuto: false
  });

  if (!result.isConfirmed) {
    this.showEditor = true;
    this.lockBody();
    this.refresh();
    return;
  }

  this.saving = true;

  try {
    // Update order and delivery statuses atomically.
    await runInInjectionContext(
      this.injector,
      () => updateDoc(
        doc(this.firestore, 'orders', order.id),
        {
          status: 'Delivered',
          deliveryStatus: 'Delivered',
          updatedAt: serverTimestamp(),
          deliveredAt: serverTimestamp(),
          deliveryUpdatedAt: serverTimestamp()
        }
      )
    );

    this.saving = false;
    this.closeEditor();
    this.refresh();

    await Swal.fire({
      icon: 'success',
      title: 'Delivery Completed',
      text: 'The order has been marked as delivered.',
      timer: 1500,
      showConfirmButton: false,
      heightAuto: false
    });

  } catch (error) {
    this.saving = false;

    console.error('Delivery completion failed:', error);

    await Swal.fire({
      icon: 'error',
      title: 'Unable to Complete Delivery',
      text: 'The update could not be completed. Please check Firebase permissions or your connection.',
      confirmButtonColor: '#287156',
      heightAuto: false
    });

    this.showEditor = true;
    this.lockBody();
    this.refresh();
  }
}

  private async showSaveError(
    error: unknown
  ): Promise<void> {
    console.error('Delivery update failed:', error);

    await Swal.fire({
      icon: 'error',
      title: 'Unable to Save',
      text:
        'The update failed. Check your internet connection and Firebase permissions.',
      confirmButtonColor: '#287156'
    });
  }
}
