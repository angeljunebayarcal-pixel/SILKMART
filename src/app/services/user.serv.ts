import {
  Injectable,
  Injector,
  runInInjectionContext
} from '@angular/core';

import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot
} from '@angular/fire/firestore';


export interface UserProfile {

  fullName: string;

  email: string;

  mobileNumber: string;

  completeAddress: string;

  role: string;

  profileImageUrl?: string;

  createdAt?: any;

}


@Injectable({
  providedIn: 'root',
})
export class UserServ {

  constructor(
    private firestore: Firestore,
    private injector: Injector
  ) {}


  // =========================================
  // CREATE PROFILE
  // =========================================

  createUserProfile(
    uid: string,
    profile: UserProfile
  ) {

    return runInInjectionContext(
      this.injector,

      () => {

        const userRef =
          doc(
            this.firestore,
            'users',
            uid
          );


        return setDoc(
          userRef,
          {
            ...profile,

            profileImageUrl:
              profile.profileImageUrl ?? '',

            createdAt:
              new Date()
          }
        );

      }
    );

  }


  // =========================================
  // GET PROFILE
  // =========================================

  async getUserProfile(
    uid: string
  ): Promise<UserProfile | null> {

    const snapshot =
      await runInInjectionContext(
        this.injector,

        () => {

          const userRef =
            doc(
              this.firestore,
              'users',
              uid
            );


          return getDoc(
            userRef
          );

        }
      );


    if (!snapshot.exists()) {

      return null;

    }


    const data =
      snapshot.data();


    return {

      fullName:
        data['fullName'] ?? '',

      email:
        data['email'] ?? '',

      mobileNumber:
        data['mobileNumber'] ?? '',

      completeAddress:
        data['completeAddress'] ?? '',

      role:
        data['role'] ?? 'customer',

      profileImageUrl:
        data['profileImageUrl'] ?? '',

      createdAt:
        data['createdAt'] ?? null

    };

  }


  // =========================================
  // LIVE PROFILE LISTENER
  // =========================================

  listenToUserProfile(
    uid: string,
    callback: (
      profile: UserProfile | null
    ) => void
  ): () => void {

    return runInInjectionContext(
      this.injector,

      () => {

        const userRef =
          doc(
            this.firestore,
            'users',
            uid
          );


        const unsubscribe =
          onSnapshot(
            userRef,

            snapshot => {

              if (!snapshot.exists()) {

                callback(null);

                return;

              }


              const data =
                snapshot.data();


              callback({

                fullName:
                  data['fullName'] ?? '',

                email:
                  data['email'] ?? '',

                mobileNumber:
                  data['mobileNumber'] ?? '',

                completeAddress:
                  data['completeAddress'] ?? '',

                role:
                  data['role'] ?? 'customer',

                profileImageUrl:
                  data['profileImageUrl'] ?? '',

                createdAt:
                  data['createdAt'] ?? null

              });

            },

            error => {

              console.error(
                'Profile listener error:',
                error
              );

              callback(null);

            }
          );


        return unsubscribe;

      }
    );

  }


  // =========================================
  // UPDATE PROFILE
  // =========================================

  updateUserProfile(
    uid: string,
    profile: Partial<UserProfile>
  ) {

    return runInInjectionContext(
      this.injector,

      () => {

        const userRef =
          doc(
            this.firestore,
            'users',
            uid
          );


        return updateDoc(
          userRef,
          {
            ...profile,

            updatedAt:
              new Date()
          }
        );

      }
    );

  }

}