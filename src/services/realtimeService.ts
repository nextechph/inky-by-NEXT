import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useDocumentStore } from '../store/useDocumentStore';
import { useToastStore } from '../store/useToastStore';
import { useAuthStore } from '../store/useAuthStore';
import { RealtimeChannel } from '@supabase/supabase-js';

let activeChannel: RealtimeChannel | null = null;

// Callback invoked when a new signed_notification arrives — updates badge counts in App
let onNewNotificationCallback: (() => void) | null = null;
// Callback invoked when a new document signing request arrives for the current user
let onNewSigningRequestCallback: ((rec: any) => void) | null = null;

export const realtimeService = {
  /**
   * Register a callback to be called when a new signed_notification INSERT fires.
   * Used by App.tsx to refresh the notification list and badge count.
   */
  onNewNotification(callback: () => void) {
    onNewNotificationCallback = callback;
  },

  /**
   * Register a callback to be called when a new document signing request is dispatched.
   * Used by App.tsx to refresh the pending requests to sign list and badge count.
   */
  onNewSigningRequest(callback: (rec: any) => void) {
    onNewSigningRequestCallback = callback;
  },

  /**
   * Subscribes to realtime changes across documents, signature fields,
   * recipients, inbox links, and signed_notifications using Supabase postgres_changes.
   */
  subscribeToAll(): () => void {
    if (!isSupabaseConfigured() || !supabase) return () => {};

    // Remove existing channel if already connected
    if (activeChannel) {
      supabase.removeChannel(activeChannel);
      activeChannel = null;
    }

    const channelName = 'inky-realtime-global';
    const channel = supabase.channel(channelName);

    // ── 1. Listen to Documents Table (Inserts, Updates, Deletions) ──
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'documents' },
      async (payload: any) => {
        const store = useDocumentStore.getState();
        const currentSelected = store.selectedDoc;

        // If on dashboard, keep list synchronized
        if (store.activeTab === 'dashboard') {
          store.fetchDocuments();
        }

        if (payload.eventType === 'INSERT') {
          const newDoc = payload.new;
          if (newDoc.source === 'inbound') {
            useToastStore.getState().showToast(
              `📥 Inbound document received: "${newDoc.title || 'Document'}" from ${newDoc.sender_name || 'Anonymous'}`,
              'info'
            );
          } else {
            useToastStore.getState().showToast(
              `📄 New document added: "${newDoc.title || 'Document'}"`,
              'info'
            );
          }
        } else if (payload.eventType === 'UPDATE') {
          const updatedDoc = payload.new;

          // Only update selectedDoc if status or title actually changed to prevent render loops
          if (
            currentSelected &&
            currentSelected.id === updatedDoc.id &&
            (currentSelected.status !== updatedDoc.status || currentSelected.title !== updatedDoc.title)
          ) {
            useDocumentStore.setState({
              selectedDoc: {
                ...currentSelected,
                status: updatedDoc.status,
                title: updatedDoc.title,
                updatedAt: updatedDoc.updated_at,
              },
            });
          }

          if (updatedDoc.status === 'completed' && currentSelected?.status !== 'completed') {
            useToastStore.getState().showToast(
              `🎉 "${updatedDoc.title || 'Document'}" has been completed by all signers!`,
              'success'
            );
          }
        }
      }
    );

    // ── 2. Listen to Signature Fields (Live Remote Signing) ──
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'signature_fields' },
      (payload: any) => {
        const currentSelected = useDocumentStore.getState().selectedDoc;

        if (payload.eventType === 'UPDATE') {
          const updatedField = payload.new;
          if (currentSelected && currentSelected.id === updatedField.document_id) {
            const currentFields = useDocumentStore.getState().fields;
            const existing = currentFields.find((f) => f.id === updatedField.id);
            // Skip echo from our own update if value and font already match
            if (
              existing &&
              existing.value === updatedField.value &&
              (existing.fontFamily || null) === (updatedField.font_family || null)
            ) {
              return;
            }
            const updated = currentFields.map((f) =>
              f.id === updatedField.id
                ? {
                    ...f,
                    value: updatedField.value,
                    fontFamily: updatedField.font_family || f.fontFamily,
                  }
                : f
            );
            useDocumentStore.setState({ fields: updated });
          }
        } else if (payload.eventType === 'INSERT') {
          const newField = payload.new;
          if (currentSelected && currentSelected.id === newField.document_id) {
            const currentFields = useDocumentStore.getState().fields;
            if (!currentFields.some((f) => f.id === newField.id)) {
              useDocumentStore.setState({
                fields: [
                  ...currentFields,
                  {
                    id: newField.id,
                    documentId: newField.document_id,
                    pageNumber: newField.page_number,
                    x: newField.x,
                    y: newField.y,
                    width: newField.width,
                    height: newField.height,
                    fieldType: newField.field_type,
                    value: newField.value,
                    fontFamily: newField.font_family,
                    required: newField.required ?? true,
                    signerId: newField.signer_id,
                    signerEmail: newField.signer_email,
                    signerOrder: newField.signer_order,
                    signerName: newField.signer_name,
                  },
                ],
              });
            }
          }
        } else if (payload.eventType === 'DELETE') {
          const deletedField = payload.old;
          if (currentSelected && deletedField?.id) {
            const currentFields = useDocumentStore.getState().fields;
            useDocumentStore.setState({
              fields: currentFields.filter((f) => f.id !== deletedField.id),
            });
          }
        }
      }
    );

    // ── 3. Listen to Document Recipients (Live Inbox Alerts for Sender & Recipient) ──
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'document_recipients' },
      (payload: any) => {
        console.log('⚡ [Realtime] Recipient event:', payload.eventType, payload.new);
        const userEmail = useAuthStore.getState().user?.email?.toLowerCase();

        if (payload.eventType === 'INSERT') {
          const rec = payload.new;
          // If current logged-in user is the recipient of this newly sent document:
          if (userEmail && rec?.email && rec.email.toLowerCase() === userEmail) {
            useToastStore.getState().showToast(
              `📬 You received a document to sign! Check your Inbox.`,
              'info'
            );
          }
          if (onNewSigningRequestCallback) {
            onNewSigningRequestCallback(rec);
          }
        } else if (payload.eventType === 'UPDATE') {
          const rec = payload.new;
          if (rec?.status === 'signed') {
            useToastStore.getState().showToast(
              `✍️ ${rec.name || rec.email} signed their portion!`,
              'success'
            );
          }
          if (onNewSigningRequestCallback) {
            onNewSigningRequestCallback(rec);
          }
          useDocumentStore.getState().fetchDocuments();
        }
      }
    );

    // ── 4. Listen to Inbox Links (Link creation & submission counts) ──
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inbox_links' },
      (payload: any) => {
        console.log('⚡ [Realtime] Inbox link event:', payload.eventType, payload.new);
      }
    );

    // ── 5. Listen to Signed Notifications (Sender's inbox — signed doc events) ──
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'signed_notifications' },
      (payload: any) => {
        console.log('⚡ [Realtime] Signed notification received:', payload.new);
        const notif = payload.new;
        if (notif) {
          const signerName = notif.signer_name || notif.signer_email || 'Someone';
          const docTitle = notif.doc_title || 'a document';
          const allComplete = notif.all_complete;
          useToastStore.getState().showToast(
            allComplete
              ? `🎉 "${docTitle}" has been fully signed by all parties!`
              : `✍️ ${signerName} signed "${docTitle}"`,
            'success'
          );
          // Notify App to refresh the notification list and badge
          if (onNewNotificationCallback) {
            onNewNotificationCallback();
          }
        }
      }
    );

    // ── 6. Subscribe with Auto-Reconnect ──
    channel.subscribe((status) => {
      console.log(`⚡ Supabase Realtime connected: ${status}`);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setTimeout(() => {
          channel.subscribe();
        }, 3000);
      }
    });

    activeChannel = channel;

    return () => {
      if (activeChannel === channel) {
        activeChannel = null;
      }
      supabase?.removeChannel(channel);
    };
  },
};
