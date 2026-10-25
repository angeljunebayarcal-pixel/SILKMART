
import { Injectable, inject } from '@angular/core';

import { Auth } from '@angular/fire/auth';

import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  orderBy,
  query,
  serverTimestamp
} from '@angular/fire/firestore';

import { Observable } from 'rxjs';

// =========================================
// CHAT MESSAGE INTERFACE
// =========================================

export interface OrderChatMessage {
  id?: string;

  senderUid: string;

  senderRole: 'customer' | 'staff';

  text: string;

  createdAt: any;
}

// =========================================
// ORDER CHAT SERVICE
// =========================================

@Injectable({
  providedIn: 'root'
})
export class OrderChatServ {

  private readonly firestore = inject(Firestore);

  private readonly auth = inject(Auth);

  // =========================================
  // FIRESTORE CONVERSATION PATH
  // =========================================

  // orders/{orderId}/messages/{messageId}

  private getMessagesCollection(orderId: string) {

    if (!orderId?.trim()) {
      throw new Error(
        'Please select an order first.'
      );
    }

    return collection(
      this.firestore,
      'orders',
      orderId,
      'messages'
    );
  }

  // =========================================
  // READ MESSAGES IN REAL TIME
  // =========================================

  getMessages(
    orderId: string
  ): Observable<OrderChatMessage[]> {

    const messagesReference =
      this.getMessagesCollection(orderId);

    const messagesQuery = query(
      messagesReference,
      orderBy('createdAt', 'asc')
    );

    return collectionData(
      messagesQuery,
      { idField: 'id' }
    ) as Observable<OrderChatMessage[]>;
  }

  // =========================================
  // SEND CHAT MESSAGE
  // =========================================

  async sendMessage(
    orderId: string,
    text: string,
    senderRole: 'customer' | 'staff'
  ): Promise<void> {

    const user = this.auth.currentUser;

    if (!user) {
      throw new Error(
        'Please sign in before sending a message.'
      );
    }

    const messageText = text.trim();

    if (!messageText) {
      throw new Error(
        'Please type a message.'
      );
    }

    if (messageText.length > 1000) {
      throw new Error(
        'Messages cannot exceed 1,000 characters.'
      );
    }

    if (
      senderRole !== 'customer' &&
      senderRole !== 'staff'
    ) {
      throw new Error(
        'Invalid message sender.'
      );
    }

    const messagesReference =
      this.getMessagesCollection(orderId);

    await addDoc(
      messagesReference,
      {
        senderUid: user.uid,

        senderRole,

        text: messageText,

        createdAt: serverTimestamp()
      }
    );
  }
}
