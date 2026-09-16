// Inky Document Service — Cloud-Synced (Supabase) + Local Offline-First Mode
import { Document, SignatureField, Recipient } from '../types';
import * as storage from '../lib/storage';
import { getPdfInfo, flattenPdfSignatures } from '../lib/pdf';
import { downloadBlob, uid } from '../utils';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// In-memory cache for active blob URLs so they can be rendered in <canvas> / pdf.js
const blobUrlCache = new Map<string, string>();
let saveDebounceTimer: any = null;

export const documentService = {
  async listDocuments(params?: { status?: string; source?: string; search?: string }): Promise<Document[]> {
    let currentUserId = 'guest';
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.id) {
          currentUserId = userData.user.id;
        }
      } catch (e) {
        console.warn('Could not read user in listDocuments:', e);
      }
    }

    let docs = storage.getLocalDocuments(currentUserId);

    if (isSupabaseConfigured() && supabase && currentUserId !== 'guest') {
      try {
        // STRICT USER ISOLATION: Only select documents belonging to the authenticated user!
        const { data, error } = await supabase
          .from('documents')
          .select('*')
          .eq('user_id', currentUserId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          const cloudDocs: Document[] = data.map((d: any) => ({
            id: d.id,
            ownerId: d.user_id,
            title: d.title,
            status: d.status,
            source: d.source,
            filePath: d.file_path,
            originalFileName: d.original_file_name || d.title,
            pageCount: d.page_count,
            senderName: d.sender_name,
            senderEmail: d.sender_email,
            createdAt: d.created_at,
            updatedAt: d.updated_at,
          }));

          const mergedMap = new Map<string, Document>();
          const cloudDocIds = new Set(cloudDocs.map((cd) => cd.id));

          // Only keep local docs that are purely offline drafts, or match cloudDocs
          docs.filter((d) => !d.ownerId || d.ownerId === currentUserId).forEach((d) => {
            const isCloudDoc = d.filePath?.startsWith('http') || (d.filePath && d.filePath.includes('/'));
            if (!isCloudDoc || cloudDocIds.has(d.id)) {
              mergedMap.set(d.id, d);
            }
          });
          cloudDocs.forEach((d) => mergedMap.set(d.id, { ...mergedMap.get(d.id), ...d }));
          docs = Array.from(mergedMap.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

          // Synchronize pruned list to localStorage so deleted cloud docs don't linger locally
          storage.saveAllLocalDocuments(docs, currentUserId);
        }
      } catch (e) {
        console.warn('Falling back to local documents:', e);
      }
    }

    if (params?.status) {
      docs = docs.filter((d) => d.status === params.status);
    }
    if (params?.source) {
      docs = docs.filter((d) => d.source === params.source);
    }
    if (params?.search) {
      const q = params.search.toLowerCase();
      docs = docs.filter((d) => d.title.toLowerCase().includes(q) || d.originalFileName.toLowerCase().includes(q));
    }

    return docs;
  },

  async upload(file: File, title?: string): Promise<Document> {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const { pageCount } = await getPdfInfo(bytes);

    const docId = `doc_${uid()}`;
    await storage.storePdfBytes(docId, bytes);

    const blob = new Blob([bytes as any], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(docId, blobUrl);

    const now = new Date().toISOString();
    const doc: Document = {
      id: docId,
      ownerId: 'local_user',
      title: title || file.name.replace(/\.[^/.]+$/, ''),
      status: 'draft',
      source: 'uploaded',
      filePath: blobUrl,
      originalFileName: file.name,
      fileSizeBytes: file.size,
      pageCount,
      createdAt: now,
      updatedAt: now,
    };

    storage.saveLocalDocumentMeta(doc);

    // Sync to Supabase if authenticated
    if (isSupabaseConfigured() && supabase) {
      supabase.auth.getUser().then(async ({ data: userData }) => {
        if (userData?.user) {
          doc.ownerId = userData.user.id;
          storage.saveLocalDocumentMeta(doc);
          const cloudPath = `${userData.user.id}/${docId}.pdf`;
          await supabase!.storage.from('documents').upload(cloudPath, file);
          await supabase!.from('documents').insert({
            id: docId,
            user_id: userData.user.id,
            title: doc.title,
            original_file_name: doc.originalFileName,
            file_path: cloudPath,
            page_count: doc.pageCount,
            status: 'draft',
            source: 'uploaded',
          });
        }
      }).catch(console.warn);
    }

    return doc;
  },

  async getDetails(id: string): Promise<Document & { fields: SignatureField[]; recipients: Recipient[] }> {
    let docs = storage.getLocalDocuments();
    let doc = docs.find((d) => d.id === id);

    let fields = storage.getLocalDocumentFields(id);
    let recipients = storage.getLocalDocumentRecipients(id);

    // If Supabase is configured, sync document metadata, recipients, and fields concurrently
    if (isSupabaseConfigured() && supabase) {
      try {
        const [cloudDocRes, cloudRecipientsRes, cloudFieldsRes] = await Promise.allSettled([
          supabase.from('documents').select('*').eq('id', id).maybeSingle(),
          supabase.from('document_recipients').select('*').eq('document_id', id),
          supabase.from('signature_fields').select('*').eq('document_id', id),
        ]);

        if (cloudDocRes.status === 'fulfilled' && cloudDocRes.value.data && !cloudDocRes.value.error) {
          const cloudDoc = cloudDocRes.value.data;
          doc = {
            id: cloudDoc.id,
            ownerId: cloudDoc.user_id,
            title: cloudDoc.title,
            status: cloudDoc.status,
            source: cloudDoc.source,
            filePath: cloudDoc.file_path,
            originalFileName: cloudDoc.original_file_name || cloudDoc.title,
            pageCount: cloudDoc.page_count || doc?.pageCount || 1,
            senderName: cloudDoc.sender_name || doc?.senderName,
            senderEmail: cloudDoc.sender_email || doc?.senderEmail,
            createdAt: cloudDoc.created_at || doc?.createdAt,
            updatedAt: cloudDoc.updated_at,
          };
          storage.saveLocalDocumentMeta(doc);
        }

        if (cloudRecipientsRes.status === 'fulfilled' && cloudRecipientsRes.value.data && cloudRecipientsRes.value.data.length > 0) {
          recipients = cloudRecipientsRes.value.data.map((r: any) => ({
            id: r.id,
            documentId: r.document_id,
            email: r.email,
            name: r.name,
            signingOrder: r.signing_order,
            status: r.status,
            signedAt: r.signed_at,
            token: r.token,
          }));
          storage.saveLocalDocumentRecipients(id, recipients);
        }

        if (cloudFieldsRes.status === 'fulfilled' && cloudFieldsRes.value.data && cloudFieldsRes.value.data.length > 0) {
          const cloudFields = cloudFieldsRes.value.data;
          const mappedCloudFields: SignatureField[] = cloudFields.map((f: any) => ({
            id: f.id,
            documentId: f.document_id,
            pageNumber: f.page_number,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            fieldType: f.field_type,
            value: f.value,
            fontFamily: f.font_family,
            required: f.required ?? true,
            signerId: f.signer_id,
            signerEmail: f.signer_email,
            signerOrder: f.signer_order,
            signerName: f.signer_name,
          }));

          const cloudIds = new Set(cloudFields.map((f: any) => f.id));
          const localOnly = fields.filter((lf) => !cloudIds.has(lf.id));
          fields = [...mappedCloudFields, ...localOnly];
          storage.saveLocalDocumentFields(id, fields);
        }
      } catch (err) {
        console.warn('Failed to sync document details from Supabase:', err);
      }
    }

    if (!doc) throw new Error('Document not found');

    let blobUrl = blobUrlCache.get(id);
    if (!blobUrl) {
      let bytes = await storage.getPdfBytes(id);

      // If bytes not in IndexedDB but file exists in Supabase Storage, download it!
      if (!bytes && isSupabaseConfigured() && supabase && doc.filePath && !doc.filePath.startsWith('blob:')) {
        try {
          const bucket = doc.source === 'inbound' ? 'inbound' : 'documents';
          const { data: fileBlob, error: downloadError } = await supabase.storage.from(bucket).download(doc.filePath);
          if (!downloadError && fileBlob) {
            const arrayBuffer = await fileBlob.arrayBuffer();
            bytes = new Uint8Array(arrayBuffer);
            await storage.storePdfBytes(id, bytes);
          } else if (downloadError) {
            // Try alternate bucket fallback
            const altBucket = bucket === 'inbound' ? 'documents' : 'inbound';
            const { data: altBlob } = await supabase.storage.from(altBucket).download(doc.filePath);
            if (altBlob) {
              const arrayBuffer = await altBlob.arrayBuffer();
              bytes = new Uint8Array(arrayBuffer);
              await storage.storePdfBytes(id, bytes);
            }
          }
        } catch (e) {
          console.warn('Failed to download PDF from Supabase storage:', e);
        }
      }

      if (bytes) {
        const blob = new Blob([bytes as any], { type: 'application/pdf' });
        blobUrl = URL.createObjectURL(blob);
        blobUrlCache.set(id, blobUrl);
      } else {
        blobUrl = doc.filePath;
      }
    }

    // Hydrate fields with any saved rawSignatures from IndexedDB
    const hydratedFields = await storage.hydrateFieldsWithRawSignatures(fields);

    return {
      ...doc,
      filePath: blobUrl,
      fields: hydratedFields,
      recipients,
    };
  },

  async saveFields(id: string, fields: SignatureField[], immediate = false): Promise<void> {
    storage.saveLocalDocumentFields(id, fields);

    if (!isSupabaseConfigured() || !supabase) return;

    const executeSupabaseSave = async () => {
      try {
        const fieldIds = fields.map((f) => f.id);

        if (fields.length > 0) {
          // Safeguard: Fetch existing cloud values to prevent overwriting recipient signatures
          let cloudValueMap = new Map<string, string | null>();
          try {
            const { data: existingCloudFields } = await supabase!
              .from('signature_fields')
              .select('id, value')
              .eq('document_id', id);
            if (existingCloudFields) {
              cloudValueMap = new Map(existingCloudFields.map((ef: any) => [ef.id, ef.value]));
            }
          } catch (_e) {}

          const rows = fields.map((f) => {
            const cloudVal = cloudValueMap.get(f.id);
            // If local value is empty but cloud has a signed value, preserve the signed cloud value!
            const finalVal = f.value || cloudVal || null;
            return {
              id: f.id,
              document_id: id,
              page_number: f.pageNumber,
              x: f.x,
              y: f.y,
              width: f.width,
              height: f.height,
              field_type: f.fieldType,
              value: finalVal,
              font_family: f.fontFamily || null,
              required: f.required ?? true,
              signer_id: f.signerId || null,
              signer_email: f.signerEmail || null,
              signer_order: f.signerOrder || null,
              signer_name: f.signerName || null,
            };
          });

          // Upsert fields in place without deleting existing rows
          const { error: upsertErr } = await supabase!
            .from('signature_fields')
            .upsert(rows, { onConflict: 'id' });

          if (upsertErr) {
            console.warn('Supabase upsert fields error:', upsertErr);
          }

          // Clean up only fields that were actually removed from this document
          const { error: delErr } = await supabase!
            .from('signature_fields')
            .delete()
            .eq('document_id', id)
            .not('id', 'in', `(${fieldIds.map((fid) => `"${fid}"`).join(',')})`);

          if (delErr) {
            console.warn('Supabase orphan delete error:', delErr);
          }
        } else {
          await supabase!
            .from('signature_fields')
            .delete()
            .eq('document_id', id);
        }
      } catch (err) {
        console.warn('Supabase fields save error:', err);
      }
    };

    if (immediate) {
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
      }
      await executeSupabaseSave();
    } else {
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
      }
      saveDebounceTimer = setTimeout(executeSupabaseSave, 400);
    }
  },

  async signAndFlatten(
    id: string,
    options?: { signerEmail?: string; signerName?: string; addAuditPage?: boolean }
  ) {
    const bytes = await storage.getPdfBytes(id);
    if (!bytes) throw new Error('PDF file data not found in local storage');

    const fields = storage.getLocalDocumentFields(id);
    const signedBytes = await flattenPdfSignatures(bytes, fields, options);

    // Save signed bytes separately WITHOUT overwriting the original base PDF
    await storage.storeSignedPdfBytes(id, signedBytes);

    // Create download blob for signed document
    const signedBlob = new Blob([signedBytes as any], { type: 'application/pdf' });

    // Update document status
    const docs = storage.getLocalDocuments();
    const doc = docs.find((d) => d.id === id);
    if (doc) {
      doc.status = 'completed';
      doc.updatedAt = new Date().toISOString();
      storage.saveLocalDocumentMeta(doc);
    }

    // Automatically trigger download of signed PDF
    const filename = `${(doc?.title || 'signed_document').replace(/\s+/g, '_')}_signed.pdf`;
    downloadBlob(signedBlob, filename);

    // Sync signed PDF to Supabase Storage if authenticated
    if (isSupabaseConfigured() && supabase) {
      supabase.auth.getUser().then(async ({ data: userData }) => {
        if (userData?.user) {
          const signedPath = `${userData.user.id}/${id}_signed.pdf`;
          const signedFile = new File([signedBytes as any], filename, { type: 'application/pdf' });
          await supabase!.storage.from('documents').upload(signedPath, signedFile, { upsert: true });
          await supabase!.from('documents').update({
            status: 'completed',
            signed_file_path: signedPath,
            updated_at: new Date().toISOString(),
          }).eq('id', id);
        }
      }).catch(console.warn);
    }

    return {
      message: 'Document signed and flattened successfully!',
      documentId: id,
      status: 'completed',
      auditHash: uid(),
    };
  },

  async delete(id: string): Promise<void> {
    const existingBlob = blobUrlCache.get(id);
    if (existingBlob) {
      URL.revokeObjectURL(existingBlob);
      blobUrlCache.delete(id);
    }

    let currentUserId = 'guest';
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.id) currentUserId = userData.user.id;
      } catch (e) {
        console.warn('Could not read user in delete:', e);
      }
    }

    // 1. Purge from local storage & IndexedDB across all storage keys
    await storage.deleteLocalDocumentRecord(id, currentUserId);

    // 2. Purge from Supabase
    if (isSupabaseConfigured() && supabase) {
      try {
        // Fetch file_path and source to delete cloud storage asset
        const { data: docRecord } = await supabase
          .from('documents')
          .select('file_path, source')
          .eq('id', id)
          .maybeSingle();

        if (docRecord?.file_path) {
          const bucket = docRecord.source === 'inbound' ? 'inbound' : 'documents';
          await supabase.storage.from(bucket).remove([docRecord.file_path]);
        }

        // Clean up child tables to avoid cascade delays or constraint issues
        await supabase.from('signature_fields').delete().eq('document_id', id);
        await supabase.from('document_recipients').delete().eq('document_id', id);
        await supabase.from('signed_notifications').delete().eq('document_id', id);

        // Await deletion of the document record
        const { error: delErr } = await supabase.from('documents').delete().eq('id', id);
        if (delErr) {
          console.error('Supabase document delete error:', delErr);
        }
      } catch (err) {
        console.error('Failed to delete document from cloud:', err);
      }
    }
  },
};
