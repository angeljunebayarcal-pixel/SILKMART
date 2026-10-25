import { CommonModule } from '@angular/common';

import {
  ChangeDetectorRef,
  Component,
  Injector,
  OnDestroy,
  OnInit,
  runInInjectionContext
} from '@angular/core';

import {
  Router,
  RouterLink,
  RouterLinkActive
} from '@angular/router';

import {
  Auth,
  onAuthStateChanged
} from '@angular/fire/auth';

import {
  UserServ,
  UserProfile
} from '../../../services/user.serv';

@Component({
  selector: 'app-topbar-adm',
  standalone: true,

  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive
  ],

  templateUrl: './topbar-adm.html',
  styleUrl: './topbar-adm.scss'
})
export class TopbarAdm implements OnInit, OnDestroy {

  // =========================================
  // NOTIFICATIONS
  // =========================================

  notificationCount = 0;

  // =========================================
  // PROFILE
  // =========================================

  profileInitial = 'A';
  profileImageUrl = '';

  // =========================================
  // NAVIGATION MENU
  // =========================================

  menuOpen = false;

  // =========================================
  // LISTENERS
  // =========================================

  private stopProfileListener:
    (() => void) | null = null;

  private stopAuthListener:
    (() => void) | null = null;

  // =========================================
  // CONSTRUCTOR
  // =========================================

  constructor(
    private router: Router,
    private auth: Auth,
    private userService: UserServ,
    private cdr: ChangeDetectorRef,
    private injector: Injector
  ) {}

  // =========================================
  // INITIALIZE
  // =========================================

  ngOnInit(): void {
    this.listenToAuthUser();
  }

  // =========================================
  // AUTHENTICATED USER
  // =========================================

  private listenToAuthUser(): void {

    this.stopAuthListener = runInInjectionContext(
      this.injector,

      () => onAuthStateChanged(
        this.auth,

        user => {

          // Stop the old profile listener
          if (this.stopProfileListener) {
            this.stopProfileListener();
            this.stopProfileListener = null;
          }

          // No authenticated admin
          if (!user) {

            this.profileInitial = 'A';
            this.profileImageUrl = '';
            this.notificationCount = 0;

            this.cdr.detectChanges();
            return;
          }

          // Get signed-in user's profile
          this.listenToProfile(user.uid);

        }
      )
    );

  }

  // =========================================
  // LIVE PROFILE LISTENER
  // =========================================

  private listenToProfile(uid: string): void {

    this.stopProfileListener =
      this.userService.listenToUserProfile(
        uid,

        (profile: UserProfile | null) => {

          // Profile not yet available
          if (!profile) {

            this.profileInitial = 'A';
            this.profileImageUrl = '';

            this.cdr.detectChanges();
            return;
          }

          // Admin name
          const name =
            profile.fullName?.trim() ?? '';

          // First letter of admin name
          this.profileInitial = name
            ? name.charAt(0).toUpperCase()
            : 'A';

          // Admin profile picture
          this.profileImageUrl =
            profile.profileImageUrl ?? '';

          this.cdr.detectChanges();

        }
      );

  }

  // =========================================
  // MENU
  // =========================================

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  // =========================================
  // NOTIFICATIONS
  // =========================================

  openNotifications(): void {

    this.closeMenu();

    this.router.navigate([
      '/home-adm/notif-adm'
    ]);

  }

  // =========================================
  // PROFILE
  // =========================================

  openProfile(): void {

    this.closeMenu();

    this.router.navigate([
      '/home-adm/profile-adm'
    ]);

  }

  // =========================================
  // CLEANUP
  // =========================================

  ngOnDestroy(): void {

    if (this.stopProfileListener) {
      this.stopProfileListener();
      this.stopProfileListener = null;
    }

    if (this.stopAuthListener) {
      this.stopAuthListener();
      this.stopAuthListener = null;
    }

  }

}