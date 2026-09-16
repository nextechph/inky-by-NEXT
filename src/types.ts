// Inky Application Types (Self-contained, matching Worklane src/types.ts pattern)

export type DocumentStatus = 'draft' | 'pending' | 'partially_signed' | 'completed' | 'sent';

export type DocumentSource = 'uploaded' | 'inbound' | 'ai';

export type FieldType = 'signature' | 'initials' | 'date' | 'name' | 'text';

export type RecipientStatus = 'pending' | 'viewed' | 'signed' | 'declined';

export interface Document {
  id: string;
  ownerId: string;
  title: string;
  status: DocumentStatus;
  source: DocumentSource;
  filePath: string;
  originalFileName: string;
  fileSizeBytes?: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  inboxLinkId?: string;
  auditHash?: string;
  senderName?: string;
  senderEmail?: string;
}

export interface SignatureField {
  id: string;
  documentId: string;
  pageNumber: number;
  x: number; // percentage 0-100 or normalized points
  y: number;
  width: number;
  height: number;
  fieldType: FieldType;
  value?: string; // image data URL or text
  rawSignature?: string; // Pure signature image data URL (without printed name)
  printedName?: string; // Text of printed name if enabled
  printedNameScale?: number; // Size scale factor (0.8 - 1.5)
  printedNameSpacing?: number; // Gap spacing in px (-15 to 35)
  fontFamily?: string; // e.g. 'Inter', 'Times New Roman', etc.
  signerId?: string;
  signerEmail?: string;
  signerName?: string;
  signerOrder?: number;
  required: boolean;
}

export interface Recipient {
  id: string;
  documentId: string;
  email: string;
  name: string;
  signingOrder: number;
  status: RecipientStatus;
  signedAt?: string;
  token: string;
}

export interface InboxLink {
  id: string;
  ownerId: string;
  token: string;
  title?: string;
  note?: string;
  expiresAt?: string;
  maxUses?: number;
  currentUses: number;
  active: boolean;
  createdAt: string;
}

export interface SavedSignature {
  id: string;
  type: 'draw' | 'type' | 'upload';
  dataUrl: string;
  rawSignature?: string;
  printedName?: string;
  printedNameScale?: number;
  printedNameSpacing?: number;
  label: string;
  isDefault: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  documentId: string;
  action: string;
  performerEmail: string;
  performerIp: string;
  timestamp: string;
  details?: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  documentType: string;
  fieldLayout: Omit<SignatureField, 'id' | 'documentId'>[];
  createdAt: string;
}

export interface UsageHistory {
  id: string;
  documentType: string;
  recipientEmail: string;
  fieldLayout: string;
  createdAt: string;
}

export type AppTab = 'dashboard' | 'editor' | 'inbox' | 'signatures' | 'history' | 'templates';

export type DocumentFilter = 'to_sign' | 'pending' | 'completed' | 'all';

export interface ToastAction {
  label: string;
  onClick: () => void;
  variant?: 'danger' | 'primary' | 'secondary';
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  msg: string;
  type: ToastType;
  action?: ToastAction;
}
