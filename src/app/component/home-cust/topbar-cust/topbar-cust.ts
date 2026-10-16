import {
  CommonModule
} from '@angular/common';

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
  selector: 'app-topbar-cust',

  standalone: true,

  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive
  ],

  templateUrl: './topbar-cust.html',

  styleUrls: [
    './topbar-cust.scss'
  ]
})
export class TopbarCust
  implements OnInit, OnDestroy {


  // =========================================
  // NOTIFICATION
  // =========================================

  notificationCount = 2;


  // =========================================
  // PROFILE
  // =========================================

  profileInitial = 'C';

  profileImageUrl = '';


  // =========================================
  // MENU
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
  // INIT
  // =========================================

  ngOnInit(): void {

    this.listenToAuthUser();

  }


  // =========================================
  // AUTH USER LISTENER
  // =========================================

  private listenToAuthUser(): void {

    this.stopAuthListener =
      runInInjectionContext(
        this.injector,

        () =>
          onAuthStateChanged(
            this.auth,

            user => {

              // =====================================
              // STOP OLD PROFILE LISTENER
              // =====================================

              if (this.stopProfileListener) {

                this.stopProfileListener();

                this.stopProfileListener = null;

              }


              // =====================================
              // GUEST / LOGGED OUT
              // =====================================

              if (!user) {

                this.profileInitial = 'C';

                this.profileImageUrl = '';

                this.cdr.detectChanges();

                return;

              }


              // =====================================
              // AUTHENTICATED USER
              // =====================================

              this.listenToProfile(
                user.uid
              );

            }
          )
      );

  }


  // =========================================
  // LIVE PROFILE LISTENER
  // =========================================

  private listenToProfile(
    uid: string
  ): void {

    this.stopProfileListener =
      this.userService
        .listenToUserProfile(

          uid,

          (
            profile:
              UserProfile | null
          ) => {

            // =================================
            // PROFILE NOT FOUND
            // =================================

            if (!profile) {

              this.profileInitial = 'C';

              this.profileImageUrl = '';

              this.cdr.detectChanges();

              return;

            }


            // =================================
            // PROFILE NAME
            // =================================

            const name =
              profile.fullName
                ?.trim() ?? '';


            // =================================
            // PROFILE INITIAL
            // =================================

            this.profileInitial =
              name
                ? name
                    .charAt(0)
                    .toUpperCase()
                : 'C';


            // =================================
            // PROFILE IMAGE
            // =================================

            this.profileImageUrl =
              profile.profileImageUrl ?? '';


            // =================================
            // UPDATE TOPBAR IMMEDIATELY
            // =================================

            this.cdr.detectChanges();

          }

        );

  }


  // =========================================
  // DESTROY
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


  // =========================================
  // MENU
  // =========================================

  toggleMenu(): void {

    this.menuOpen =
      !this.menuOpen;

  }


  closeMenu(): void {

    this.menuOpen =
      false;

  }


  // =========================================
  // NOTIFICATIONS
  // =========================================

  openNotifications(): void {

    this.closeMenu();

    this.router.navigate([
      '/home-cust/notif-cust'
    ]);

  }


  // =========================================
  // PROFILE
  // =========================================

  openProfile(): void {

    this.closeMenu();

    this.router.navigate([
      '/home-cust/profile'
    ]);

  }

}