import { SavedSignature, Document, SignatureField, Recipient, InboxLink } from '../types';

const SIGNATURES_KEY = 'esign_saved_signatures';
const DEFAULT_SIG_KEY = 'esign_default_signature_id';
const DOCUMENTS_KEY = 'inky_local_documents';
const INBOX_LINKS_KEY = 'inky_local_inbox_links';
const DB_NAME = 'inky_db';
const STORE_NAME = 'pdf_files';

// ── IndexedDB Helper for Local PDF Binary Storage ──────────────────────────
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storePdfBytes(id: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // Store both under plain id and original_id
    store.put(bytes, `original_${id}`);
    store.put(bytes, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOriginalPdfBytes(id: string): Promise<Uint8Array | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(`original_${id}`);
    req.onsuccess = () => {
      if (req.result) {
        resolve(req.result);
      } else {
        // Fallback to plain id if original_id wasn't saved yet
        const reqFallback = store.get(id);
        reqFallback.onsuccess = () => resolve(reqFallback.result || null);
        reqFallback.onerror = () => resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLocalPdfBlob(id: string): Promise<Blob | null> {
  const bytes = await getOriginalPdfBytes(id);
  if (!bytes) return null;
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

export async function storeSignedPdfBytes(id: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(bytes, `signed_${id}`);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getSignedPdfBytes(id: string): Promise<Uint8Array | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(`signed_${id}`);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getPdfBytes(id: string): Promise<Uint8Array | null> {
  return getOriginalPdfBytes(id);
}

export async function removePdfBytes(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(`original_${id}`);
    store.delete(`signed_${id}`);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Document Storage ───────────────────────────────────────────────────────
export function getLocalDocuments(userId?: string): Document[] {
  try {
    const key = userId && userId !== 'guest' ? `inky_docs_${userId}` : DOCUMENTS_KEY;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to parse local documents:', e);
    return [];
  }
}

export function saveLocalDocumentMeta(doc: Document, userId?: string): void {
  const targetUserId = userId || (doc.ownerId && doc.ownerId !== 'local_user' ? doc.ownerId : 'guest');
  const key = targetUserId !== 'guest' ? `inky_docs_${targetUserId}` : DOCUMENTS_KEY;
  const docs = getLocalDocuments(targetUserId);
  const index = docs.findIndex((d) => d.id === doc.id);
  if (index >= 0) {
    docs[index] = doc;
  } else {
    docs.unshift(doc);
  }
  localStorage.setItem(key, JSON.stringify(docs));
}

export function saveAllLocalDocuments(docs: Document[], userId?: string): void {
  const targetUserId = userId || 'guest';
  const key = targetUserId !== 'guest' ? `inky_docs_${targetUserId}` : DOCUMENTS_KEY;
  localStorage.setItem(key, JSON.stringify(docs));
}

export async function deleteLocalDocumentRecord(id: string, userId?: string): Promise<void> {
  // 1. Remove from target user or guest key
  const targetUserId = userId || 'guest';
  const key = targetUserId !== 'guest' ? `inky_docs_${targetUserId}` : DOCUMENTS_KEY;
  const docs = getLocalDocuments(targetUserId).filter((d) => d.id !== id);
  localStorage.setItem(key, JSON.stringify(docs));

  // 2. Also remove from DOCUMENTS_KEY if target was a user
  if (targetUserId !== 'guest') {
    const guestDocs = getLocalDocuments('guest').filter((d) => d.id !== id);
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(guestDocs));
  }

  // 3. Scan and purge across ALL inky_docs_* keys in localStorage
  try {
    const keysToCheck: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === DOCUMENTS_KEY || k.startsWith('inky_docs_'))) {
        keysToCheck.push(k);
      }
    }
    for (const k of keysToCheck) {
      const raw = localStorage.getItem(k);
      if (raw && raw.includes(id)) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const filtered = list.filter((d: any) => d.id !== id);
            localStorage.setItem(k, JSON.stringify(filtered));
          }
        } catch {
          // ignore
        }
      }
    }
  } catch (e) {
    console.warn('Error purging doc across stores:', e);
  }

  localStorage.removeItem(`inky_fields_${id}`);
  localStorage.removeItem(`inky_recipients_${id}`);
  await removePdfBytes(id);
}

export function getLocalDocumentFields(docId: string): SignatureField[] {
  try {
    const raw = localStorage.getItem(`inky_fields_${docId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalDocumentFields(docId: string, fields: SignatureField[]): void {
  try {
    // Exclude rawSignature from localStorage payload to keep it lean and prevent quota errors
    const sanitized = fields.map((f) => {
      if (f.rawSignature) {
        const { rawSignature, ...rest } = f;
        return rest;
      }
      return f;
    });
    localStorage.setItem(`inky_fields_${docId}`, JSON.stringify(sanitized));
  } catch (err) {
    console.warn('Could not save document fields to localStorage (quota limit reached):', err);
  }
}

export function getLocalDocumentRecipients(docId: string): Recipient[] {
  try {
    const raw = localStorage.getItem(`inky_recipients_${docId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalDocumentRecipients(docId: string, recipients: Recipient[]): void {
  localStorage.setItem(`inky_recipients_${docId}`, JSON.stringify(recipients));
}

// ── Inbox Links Storage ────────────────────────────────────────────────────
export function getLocalInboxLinks(): InboxLink[] {
  try {
    const raw = localStorage.getItem(INBOX_LINKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalInboxLink(link: InboxLink): void {
  const links = getLocalInboxLinks();
  links.unshift(link);
  localStorage.setItem(INBOX_LINKS_KEY, JSON.stringify(links));
}

export function deleteLocalInboxLink(idOrToken: string): void {
  const links = getLocalInboxLinks().filter((l) => l.id !== idOrToken && l.token !== idOrToken);
  localStorage.setItem(INBOX_LINKS_KEY, JSON.stringify(links));
}

// ── Saved Signatures Storage ───────────────────────────────────────────────
export function getSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(SIGNATURES_KEY);
    if (!raw) return [];
    let list: SavedSignature[] = JSON.parse(raw);
    let changed = false;
    list = list.map((sig) => {
      // Auto-correct any legacy signature label where mixed case like "MARK james" was saved
      if (sig.label && sig.label.toLowerCase() === 'mark james' && sig.label !== 'MARK JAMES') {
        changed = true;
        return { ...sig, label: 'MARK JAMES' };
      }
      return sig;
    });
    if (changed) {
      localStorage.setItem(SIGNATURES_KEY, JSON.stringify(list));
    }
    return list;
  } catch (e) {
    console.error('Failed to parse saved signatures:', e);
    return [];
  }
}

export function saveSignature(sig: Omit<SavedSignature, 'id' | 'createdAt'>): SavedSignature {
  const existing = getSavedSignatures();
  const newSig: SavedSignature = {
    ...sig,
    id: `sig_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    createdAt: new Date().toISOString(),
  };

  if (sig.isDefault || existing.length === 0) {
    existing.forEach((s) => (s.isDefault = false));
    newSig.isDefault = true;
    localStorage.setItem(DEFAULT_SIG_KEY, newSig.id);
  }

  const updated = [newSig, ...existing];
  localStorage.setItem(SIGNATURES_KEY, JSON.stringify(updated));
  return newSig;
}

export function deleteSavedSignature(id: string): SavedSignature[] {
  const existing = getSavedSignatures().filter((s) => s.id !== id);
  localStorage.setItem(SIGNATURES_KEY, JSON.stringify(existing));
  return existing;
}

export function getDefaultSignature(): SavedSignature | null {
  const signatures = getSavedSignatures();
  if (signatures.length === 0) return null;
  const defaultId = localStorage.getItem(DEFAULT_SIG_KEY);
  return signatures.find((s) => s.id === defaultId || s.isDefault) || signatures[0];
}

export function setDefaultSignature(id: string): SavedSignature[] {
  const signatures = getSavedSignatures();
  signatures.forEach((s) => {
    s.isDefault = s.id === id;
  });
  localStorage.setItem(DEFAULT_SIG_KEY, id);
  localStorage.setItem(SIGNATURES_KEY, JSON.stringify(signatures));
  return signatures;
}

export function updateSavedSignatureLabel(id: string, label: string): SavedSignature[] {
  const signatures = getSavedSignatures();
  const target = signatures.find((s) => s.id === id);
  if (target) {
    target.label = label.trim() || 'Signature';
    localStorage.setItem(SIGNATURES_KEY, JSON.stringify(signatures));
  }
  return signatures;
}

// ── Dismissed Signing Requests & Notifications Store ───────────────────────
const DISMISSED_SIGNING_REQUESTS_KEY = 'inky_dismissed_signing_requests';
const DISMISSED_NOTIFICATIONS_KEY = 'inky_dismissed_notifications';

export function getDismissedSigningRequestIds(userEmail?: string): string[] {
  try {
    const globalRaw = localStorage.getItem(DISMISSED_SIGNING_REQUESTS_KEY);
    const globalList: string[] = globalRaw ? JSON.parse(globalRaw) : [];

    if (userEmail) {
      const clean = userEmail.trim().toLowerCase();
      const userRaw = localStorage.getItem(`${DISMISSED_SIGNING_REQUESTS_KEY}_${clean}`);
      const userList: string[] = userRaw ? JSON.parse(userRaw) : [];
      return Array.from(new Set([...globalList, ...userList]));
    }
    return globalList;
  } catch {
    return [];
  }
}

export function addDismissedSigningRequestId(
  id: string,
  userEmail?: string,
  token?: string,
  documentId?: string
): void {
  try {
    const toAdd: string[] = [];
    if (id) toAdd.push(id);
    if (token) toAdd.push(token);
    if (documentId) toAdd.push(documentId);

    // 1. Global list
    const globalList = getDismissedSigningRequestIds();
    const updatedGlobal = Array.from(new Set([...globalList, ...toAdd]));
    localStorage.setItem(DISMISSED_SIGNING_REQUESTS_KEY, JSON.stringify(updatedGlobal));

    // 2. User-scoped list
    if (userEmail) {
      const clean = userEmail.trim().toLowerCase();
      const userKey = `${DISMISSED_SIGNING_REQUESTS_KEY}_${clean}`;
      const raw = localStorage.getItem(userKey);
      const userList: string[] = raw ? JSON.parse(raw) : [];
      const updatedUser = Array.from(new Set([...userList, ...toAdd]));
      localStorage.setItem(userKey, JSON.stringify(updatedUser));
    }
  } catch (e) {
    console.warn('Failed to record dismissed signing request id:', e);
  }
}

export function purgeLocalRecipient(id: string, token?: string, documentId?: string): void {
  try {
    if (documentId) {
      const recs = getLocalDocumentRecipients(documentId).filter(
        (r) => r.id !== id && (!token || r.token !== token)
      );
      saveLocalDocumentRecipients(documentId, recs);
    }

    // Scan all inky_recipients_* keys in localStorage
    const recipientKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('inky_recipients_')) {
        recipientKeys.push(k);
      }
    }

    for (const key of recipientKeys) {
      const raw = localStorage.getItem(key);
      if (raw && (raw.includes(id) || (token && raw.includes(token)))) {
        try {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const filtered = list.filter(
              (r: any) => r.id !== id && (!token || r.token !== token)
            );
            localStorage.setItem(key, JSON.stringify(filtered));
          }
        } catch {
          // ignore
        }
      }
    }
  } catch (e) {
    console.warn('Error purging local recipient across stores:', e);
  }
}

export function getDismissedNotificationIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addDismissedNotificationId(id: string): void {
  try {
    const current = getDismissedNotificationIds();
    const updated = Array.from(new Set([...current, id]));
    localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to record dismissed notification id:', e);
  }
}

