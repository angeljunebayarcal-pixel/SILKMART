import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideFirebaseApp(() =>
      initializeApp({
        apiKey: 'AIzaSyDQACUhLjAjYkdffV89l9FtnR83vGW4zzs',
        authDomain: 'silkmart-5f5ca.firebaseapp.com',
        projectId: 'silkmart-5f5ca',
        storageBucket: 'silkmart-5f5ca.firebasestorage.app',
        messagingSenderId: '400238341924',
        appId: '1:400238341924:web:d00d9caab9ce87fccf8db1',
        measurementId: 'G-FGTXEGMGBD',
      }),
    ),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),
  ],
};
