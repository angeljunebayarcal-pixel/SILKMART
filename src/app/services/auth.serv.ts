import {
  Injectable
} from '@angular/core';

import {
  Auth,
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from '@angular/fire/auth';


@Injectable({
  providedIn: 'root'
})
export class AuthServ {

  constructor(
    private auth: Auth
  ) {}


  // =========================================
  // CURRENT USER
  // =========================================

  get currentUser(): User | null {

    return this.auth.currentUser;

  }


  // =========================================
  // LOGIN
  // =========================================

  login(
    email: string,
    password: string
  ) {

    return signInWithEmailAndPassword(
      this.auth,
      email,
      password
    );

  }


  // =========================================
  // REGISTER
  // =========================================

  register(
    email: string,
    password: string
  ) {

    return createUserWithEmailAndPassword(
      this.auth,
      email,
      password
    );

  }


  // =========================================
  // LOGOUT
  // =========================================

  logout() {

    return signOut(
      this.auth
    );

  }

}