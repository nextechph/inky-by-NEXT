// Inky Delivery Service — Local-First + Supabase Multi-Signer Workflow
import { Recipient, Document, SignatureField, FieldType } from '../types';
import * as storage from '../lib/storage';
import { uid } from '../utils';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { emailService, EmailDispatchResult } from './emailService';
import { notificationService } from './notificationService';

export interface DispatchedRecipient extends Recipient {
  signingUrl: string;
  mailtoUrl: string;
  gmailUrl: string;
  emailSubject: string;
  emailBody: string;
  emailSent?: boolean;
  emailError?: string;
}

/**
 * Ensures the document record, PDF file, signature fields, and recipients
 * are all synced to Supabase so that remote signers can access them.
 * This MUST be awaited before generating signing links.
 */
async function ensureCloudSync(docId: string, recipients: Recipient[]): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured — signing links will only work in this browser.');
    return;
  }

  // Get the authenticated user
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) {
    console.warn('User not authenticated — cloud sync skipped. Remote signers will not be able to access the document.');
    return;
  }

  const doc = storage.getLocalDocuments().find((d) => d.id === docId);
  if (!doc) return;

  // 1. Ensure document record exists in Supabase
  const { data: existingDoc } = await supabase
    .from('documents')
    .select('id')
    .eq('id', docId)
    .maybeSingle();

  const senderName = userData?.user?.user_metadata?.full_name || userData?.user?.user_metadata?.name || userData?.user?.email || 'Inky';
  const senderEmail = userData?.user?.email || null;

  if (!existingDoc) {
    // Upload PDF to storage first
    const pdfBytes = await storage.getPdfBytes(docId);
    if (pdfBytes) {
      const cloudPath = `${userId}/${docId}.pdf`;
      const pdfFile = new File([pdfBytes as any], `${docId}.pdf`, { type: 'application/pdf' });
      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(cloudPath, pdfFile, { upsert: true });
      if (uploadErr) {
        console.error('Failed to upload PDF to Supabase Storage:', uploadErr);
      }

      // Insert document record
      const { error: insertErr } = await supabase.from('documents').insert({
        id: docId,
        user_id: userId,
        title: doc.title,
        original_file_name: doc.originalFileName || doc.title,
        file_path: cloudPath,
        page_count: doc.pageCount || 1,
        status: doc.status || 'draft',
        source: doc.source || 'uploaded',
        sender_name: senderName,
        sender_email: senderEmail,
      });
      if (insertErr) {
        console.error('Failed to insert document to Supabase:', insertErr);
      }
    }
  } else {
    // Document exists — ensure PDF is in storage and update sender info
    await supabase.from('documents').update({
      sender_name: senderName,
      sender_email: senderEmail,
    }).eq('id', docId);

    const { data: docRecord } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', docId)
      .maybeSingle();

    if (docRecord && !docRecord.file_path) {
      const pdfBytes = await storage.getPdfBytes(docId);
      if (pdfBytes) {
        const cloudPath = `${userId}/${docId}.pdf`;
        const pdfFile = new File([pdfBytes as any], `${docId}.pdf`, { type: 'application/pdf' });
        await supabase.storage.from('documents').upload(cloudPath, pdfFile, { upsert: true });
        await supabase.from('documents').update({ file_path: cloudPath }).eq('id', docId);
      }
    }
  }

  // 2. Sync signature fields
  const fields = storage.getLocalDocumentFields(docId);
  if (fields.length > 0) {
    const fieldRows = fields.map((f) => {
      const isAssigned = Boolean(f.signerOrder || f.signerEmail || f.signerId);
      const targetRec = recipients.find(
        (r) => (f.signerOrder && r.signingOrder === f.signerOrder) || (f.signerEmail && r.email.toLowerCase() === f.signerEmail.toLowerCase())
      );
      const isAlreadySigned = targetRec && targetRec.status === 'signed';
      const cleanValue = (isAssigned && !isAlreadySigned) ? null : (f.value || null);

      return {
        id: f.id,
        document_id: docId,
        page_number: f.pageNumber,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        field_type: f.fieldType,
        value: cleanValue,
        font_family: f.fontFamily || null,
        required: f.required ?? true,
        signer_id: f.signerId || null,
        signer_email: f.signerEmail || null,
        signer_order: f.signerOrder || null,
        signer_name: f.signerName || null,
      };
    });
    const { error: fieldsErr } = await supabase.from('signature_fields').upsert(fieldRows, { onConflict: 'id' });
    if (fieldsErr) {
      console.error('Failed to sync fields to Supabase:', fieldsErr);
    }
    const fieldIds = fields.map((f) => f.id);
    await supabase.from('signature_fields').delete().eq('document_id', docId).not('id', 'in', `(${fieldIds.map((fid) => `"${fid}"`).join(',')})`);
  }

  // 3. Sync recipients
  if (recipients.length > 0) {
    const recipientRows = recipients.map((r) => ({
      id: r.id,
      document_id: r.documentId,
      email: r.email,
      name: r.name,
      signing_order: r.signingOrder,
      status: r.status,
      token: r.token,
    }));
    const { error: recErr } = await supabase
      .from('document_recipients')
      .upsert(recipientRows);
    if (recErr) {
      console.error('Failed to sync recipients to Supabase:', recErr);
    }
  }

  console.log('✅ Cloud sync complete for document', docId);
}

export const deliveryService = {
  getRecipients(docId: string): Recipient[] {
    return storage.getLocalDocumentRecipients(docId);
  },

  async setRecipients(docId: string, recipients: { email: string; name: string; signingOrder?: number }[]): Promise<Recipient[]> {
    const list: Recipient[] = recipients.map((r, idx) => ({
      id: `rec_${uid()}`,
      documentId: docId,
      email: r.email.trim(),
      name: r.name.trim(),
      signingOrder: r.signingOrder || idx + 1,
      status: 'pending',
      token: `ink_sign_${uid()}_${Math.random().toString(36).substring(2, 10)}`,
    }));

    storage.saveLocalDocumentRecipients(docId, list);

    // Cloud sync of recipients happens in sendDocument via ensureCloudSync
    return list;
  },

  async sendDocument(docId: string): Promise<{ message: string; recipients: DispatchedRecipient[] }> {
    const rawRecipients = storage.getLocalDocumentRecipients(docId);
    const docs = storage.getLocalDocuments();
    const doc = docs.find((d) => d.id === docId);

    // ── CRITICAL: Sync everything to Supabase BEFORE generating links ──
    await ensureCloudSync(docId, rawRecipients);
    
    if (doc) {
      doc.status = 'sent';
      doc.updatedAt = new Date().toISOString();
      storage.saveLocalDocumentMeta(doc);

      if (isSupabaseConfigured() && supabase) {
        try {
          const { data: authData } = await supabase.auth.getUser();
          const sName = authData?.user?.user_metadata?.full_name || authData?.user?.user_metadata?.name || authData?.user?.email || 'Inky';
          const sEmail = authData?.user?.email || null;
          await supabase.from('documents').update({
            status: 'sent',
            updated_at: doc.updatedAt,
            sender_name: sName,
            sender_email: sEmail,
          }).eq('id', docId);
        } catch (e) {
          console.warn('Supabase document status update notice:', e);
        }
      }
    }

    const docTitle = doc?.title || 'Document';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const dispatched: DispatchedRecipient[] = rawRecipients.map((r) => {
      const signingUrl = `${origin}/sign/${r.token}`;
      const rawSubject = `Signature requested: ${docTitle}`;
      const rawBody = `Hello ${r.name},\n\nYou have been invited to review and sign "${docTitle}".\n\nPlease click your secure personal signing link below:\n${signingUrl}\n\n— Sent via Inky`;
      
      const subjectEnc = encodeURIComponent(rawSubject);
      const bodyEnc = encodeURIComponent(rawBody);
      const mailtoUrl = `mailto:${r.email}?subject=${subjectEnc}&body=${bodyEnc}`;
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(r.email)}&su=${subjectEnc}&body=${bodyEnc}`;

      return {
        ...r,
        signingUrl,
        mailtoUrl,
        gmailUrl,
        emailSubject: rawSubject,
        emailBody: rawBody,
      };
    });

    // ── Automated Gmail SMTP Dispatch via Supabase Edge Function ──
    if (isSupabaseConfigured() && supabase) {
      let senderName = 'Inky';
      try {
        const { data: authData } = await supabase.auth.getUser();
        senderName = authData?.user?.user_metadata?.full_name || authData?.user?.email || 'Inky';
      } catch (e) {
        console.warn('Could not read user profile for senderName:', e);
      }

      await Promise.all(
        dispatched.map(async (item) => {
          const res = await emailService.sendSigningInvitation({
            to: item.email,
            recipientName: item.name,
            docTitle,
            signingUrl: item.signingUrl,
            senderName,
          });
          item.emailSent = res.success;
          if (!res.success) {
            item.emailError = res.error;
          }
        })
      );
    }

    return {
      message: `Document dispatched to ${dispatched.length} recipient${dispatched.length > 1 ? 's' : ''}`,
      recipients: dispatched,
    };
  },

  async resendSignerEmail(recipient: DispatchedRecipient, docTitle: string = 'Document'): Promise<EmailDispatchResult> {
    let senderName = 'Inky';
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        senderName = authData?.user?.user_metadata?.full_name || authData?.user?.email || 'Inky';
      } catch (e) {
        console.warn('Could not read user profile for senderName:', e);
      }
    }
    return emailService.sendSigningInvitation({
      to: recipient.email,
      recipientName: recipient.name,
      docTitle,
      signingUrl: recipient.signingUrl,
      senderName,
    });
  },

  buildMailtoUrl(recipient: Recipient, docTitle: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const signingUrl = `${origin}/sign/${recipient.token}`;
    const subject = encodeURIComponent(`Signature requested: ${docTitle}`);
    const body = encodeURIComponent(
      `Hello ${recipient.name},\n\nYou have been invited to review and sign "${docTitle}".\n\nPlease click your secure personal signing link below:\n${signingUrl}\n\n— Sent via Inky`
    );
    return `mailto:${recipient.email}?subject=${subject}&body=${body}`;
  },

  async shareViaDevice(title: string, text: string, url: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return true;
      } catch (err: any) {
        if (err.name === 'AbortError') return false;
      }
    }
    // Fallback: Copy to clipboard
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    }
    return false;
  },

  async getSignerContext(token: string): Promise<{
    recipient: Recipient;
    document: Document;
    fields: SignatureField[];
    pdfBlob: Blob | null;
  } | null> {
    // 1. Try local storage first
    const docs = storage.getLocalDocuments();
    for (const doc of docs) {
      const recipients = storage.getLocalDocumentRecipients(doc.id);
      const rec = recipients.find((r) => r.token === token);
      if (rec) {
        let fields = storage.getLocalDocumentFields(doc.id);
        if (rec.status !== 'signed') {
          fields = fields.map((f) => {
            const isMine = (f.signerOrder && f.signerOrder === rec.signingOrder) ||
                           (f.signerEmail && f.signerEmail.toLowerCase() === rec.email.toLowerCase()) ||
                           (f.signerId && f.signerId === rec.id);
            return isMine ? { ...f, value: '' } : f;
          });
        }
        const pdfBlob = await storage.getLocalPdfBlob(doc.id);
        return { recipient: rec, document: doc, fields, pdfBlob };
      }
    }

    // 2. Try Supabase if configured
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: recData, error: recErr } = await supabase
          .from('document_recipients')
          .select('*')
          .eq('token', token)
          .maybeSingle();

        if (recData && !recErr) {
          const rec: Recipient = {
            id: recData.id,
            documentId: recData.document_id,
            email: recData.email,
            name: recData.name,
            signingOrder: recData.signing_order,
            status: recData.status,
            signedAt: recData.signed_at,
            token: recData.token,
          };

          const { data: docData } = await supabase
            .from('documents')
            .select('*')
            .eq('id', rec.documentId)
            .maybeSingle();

          if (docData) {
            const document: Document = {
              id: docData.id,
              ownerId: docData.user_id,
              title: docData.title,
              status: docData.status,
              source: docData.source,
              filePath: docData.file_path,
              originalFileName: docData.original_file_name,
              pageCount: docData.page_count,
              createdAt: docData.created_at,
              updatedAt: docData.updated_at,
            };

            const { data: fieldsData } = await supabase
              .from('signature_fields')
              .select('*')
              .eq('document_id', rec.documentId);

            const fields: SignatureField[] = (fieldsData || []).map((f) => {
              const isMine = (f.signer_order && f.signer_order === rec.signingOrder) ||
                             (f.signer_email && f.signer_email.toLowerCase() === rec.email.toLowerCase()) ||
                             (f.signer_id && f.signer_id === rec.id);
              return {
                id: f.id,
                documentId: f.document_id,
                pageNumber: f.page_number,
                x: f.x,
                y: f.y,
                width: f.width,
                height: f.height,
                fieldType: f.field_type,
                value: (isMine && rec.status !== 'signed') ? '' : (f.value || ''),
                fontFamily: f.font_family,
                required: f.required ?? true,
                signerId: f.signer_id,
                signerEmail: f.signer_email,
                signerOrder: f.signer_order,
                signerName: f.signer_name,
              };
            });

            // Download PDF from storage bucket
            let pdfBlob: Blob | null = null;
            if (docData.file_path) {
              const { data: fileBlob } = await supabase.storage.from('documents').download(docData.file_path);
              pdfBlob = fileBlob;
            }

            return { recipient: rec, document, fields, pdfBlob };
          }
        }
      } catch (err) {
        console.error('Failed to get signer context from Supabase', err);
      }
    }

    return null;
  },

  async submitSignerFields(
    token: string,
    fieldUpdates: {
      fieldId: string;
      value: string;
      fontFamily?: string;
      fieldMeta?: {
        pageNumber: number;
        x: number;
        y: number;
        width: number;
        height: number;
        fieldType?: FieldType;
      };
    }[]
  ): Promise<{ success: boolean; message: string; allComplete: boolean }> {
    const ctx = await this.getSignerContext(token);
    if (!ctx) throw new Error('Invalid signing session');

    const { recipient, document, fields } = ctx;

    // Update existing field values and merge dynamically placed fields
    const updatedFields: SignatureField[] = [...fields];

    for (const up of fieldUpdates) {
      const existingIdx = updatedFields.findIndex((f) => f.id === up.fieldId);
      if (existingIdx >= 0) {
        const existingField = updatedFields[existingIdx];
        // Security check: Never allow a signer to overwrite a field belonging to the owner or another recipient
        const isOwnerField = existingField.signerOrder === 0 || (document.senderEmail && existingField.signerEmail && existingField.signerEmail.toLowerCase() === document.senderEmail.toLowerCase());
        const isOtherRecipient = typeof existingField.signerOrder === 'number' && existingField.signerOrder > 0 && existingField.signerOrder !== recipient.signingOrder;
        if (isOwnerField || isOtherRecipient) {
          console.warn(`Prevented signer ${recipient.email} from overwriting protected field ${up.fieldId}`);
          continue;
        }

        updatedFields[existingIdx] = {
          ...updatedFields[existingIdx],
          value: up.value,
          fontFamily: up.fontFamily || updatedFields[existingIdx].fontFamily,
          ...(up.fieldMeta
            ? {
                x: up.fieldMeta.x,
                y: up.fieldMeta.y,
                width: up.fieldMeta.width,
                height: up.fieldMeta.height,
                pageNumber: up.fieldMeta.pageNumber,
              }
            : {}),
        };
      } else if (up.fieldMeta) {
        // Dynamically added field by the signer
        updatedFields.push({
          id: up.fieldId,
          documentId: document.id,
          pageNumber: up.fieldMeta.pageNumber || 1,
          x: up.fieldMeta.x ?? 30,
          y: up.fieldMeta.y ?? 70,
          width: up.fieldMeta.width ?? 34,
          height: up.fieldMeta.height ?? 9,
          fieldType: up.fieldMeta.fieldType || 'signature',
          value: up.value,
          fontFamily: up.fontFamily,
          required: true,
          signerId: recipient.id,
          signerEmail: recipient.email,
          signerOrder: recipient.signingOrder,
          signerName: recipient.name,
        });
      }
    }
    storage.saveLocalDocumentFields(document.id, updatedFields);

    // Update recipient status
    const allRecipients = storage.getLocalDocumentRecipients(document.id);
    const now = new Date().toISOString();
    const updatedRecipients = allRecipients.map((r) =>
      r.token === token ? { ...r, status: 'signed' as const, signedAt: now } : r
    );
    storage.saveLocalDocumentRecipients(document.id, updatedRecipients);

    const allComplete = updatedRecipients.every((r) => r.status === 'signed');
    const newDocStatus = allComplete ? 'completed' : 'partially_signed';

    document.status = newDocStatus;
    document.updatedAt = now;
    storage.saveLocalDocumentMeta(document);

    // Cloud sync
    if (isSupabaseConfigured() && supabase) {
      try {
        await supabase
          .from('document_recipients')
          .update({ status: 'signed', signed_at: now })
          .eq('token', token);

        for (const up of fieldUpdates) {
          const existing = fields.find((f) => f.id === up.fieldId);
          if (existing) {
            await supabase
              .from('signature_fields')
              .update({
                value: up.value,
                font_family: up.fontFamily,
                ...(up.fieldMeta
                  ? {
                      x: up.fieldMeta.x,
                      y: up.fieldMeta.y,
                      width: up.fieldMeta.width,
                      height: up.fieldMeta.height,
                    }
                  : {}),
              })
              .eq('id', up.fieldId);
          } else if (up.fieldMeta) {
            await supabase.from('signature_fields').insert({
              id: up.fieldId,
              document_id: document.id,
              page_number: up.fieldMeta.pageNumber || 1,
              x: up.fieldMeta.x ?? 30,
              y: up.fieldMeta.y ?? 70,
              width: up.fieldMeta.width ?? 34,
              height: up.fieldMeta.height ?? 9,
              field_type: up.fieldMeta.fieldType || 'signature',
              value: up.value,
              font_family: up.fontFamily,
              required: true,
              signer_id: recipient.id,
              signer_email: recipient.email,
              signer_order: recipient.signingOrder,
              signer_name: recipient.name,
            });
          }
        }

        await supabase
          .from('documents')
          .update({ status: newDocStatus, updated_at: now })
          .eq('id', document.id);

        // ── Notify the document owner (sender) ──
        // 1. Fetch the owner's email so we can send them a completion email
        let ownerEmail: string | null = null;
        let ownerName: string | null = null;
        try {
          const { data: ownerData } = await supabase
            .from('documents')
            .select('user_id')
            .eq('id', document.id)
            .maybeSingle();
          if (ownerData?.user_id) {
            // Look up auth user profile via admin RPC or stored metadata
            // We store the owner info in the doc row itself if available
            const { data: senderDoc } = await supabase
              .from('documents')
              .select('sender_email, sender_name')
              .eq('id', document.id)
              .maybeSingle();
            // For owned (non-inbound) docs, sender_email won't be set.
            // Fall back to the auth user lookup via get_user_email RPC if available.
            // We'll pass the owner_user_id to the notification table and resolve from there.
          }
        } catch (_e) { /* non-critical */ }

        // 2. Insert signed_notification row — triggers Realtime for the owner's app
        await notificationService.insertSignedNotification({
          documentId: document.id,
          recipientId: recipient.id,
          ownerUserId: document.ownerId,
          signerName: recipient.name,
          signerEmail: recipient.email,
          docTitle: document.title,
          allComplete,
        });

        // 3. Send completion email to the document owner
        //    We need the owner's email — look it up from the document record
        //    or from a stored sender_email field if available.
        //    We pass this to the edge function which retrieves the owner email via service role.
        //    If unavailable client-side, we still insert the notification (Realtime covers it).
        try {
          await emailService.sendSignedCompletionNotification({
            to: '', // Will be resolved server-side by the edge function from owner_user_id
            signerName: recipient.name,
            signerEmail: recipient.email,
            docTitle: document.title,
            allComplete,
            // Pass extra context for server-side email resolution
            ...({ ownerUserId: document.ownerId } as any),
          });
        } catch (_emailErr) {
          console.warn('Completion email dispatch skipped (non-critical):', _emailErr);
        }
      } catch (err) {
        console.warn('Supabase sync notice during signing submission:', err);
      }
    }

    const wasAlreadySigned = recipient.status === 'signed';

    return {
      success: true,
      message: wasAlreadySigned
        ? 'Your revised signature has been recorded and the document has been updated!'
        : (allComplete ? 'Document successfully completed by all signers!' : 'Your signature has been recorded!'),
      allComplete,
    };
  },
};

