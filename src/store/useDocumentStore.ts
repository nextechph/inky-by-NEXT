// Inky Document Store (matching Worklane src/store pattern)
import { create } from 'zustand';
import { Document, SignatureField, Recipient, AppTab, DocumentFilter } from '../types';
import { documentService } from '../services/documentService';
import { useToastStore } from './useToastStore';

interface DocumentState {
  documents: Document[];
  selectedDoc: (Document & { fields?: SignatureField[]; recipients?: Recipient[] }) | null;
  fields: SignatureField[];
  activeTab: AppTab;
  filter: DocumentFilter;
  searchQuery: string;
  isLoading: boolean;
  isSigningLoading: boolean;

  // Actions
  setActiveTab: (tab: AppTab) => void;
  setFilter: (filter: DocumentFilter) => void;
  setSearchQuery: (query: string) => void;
  setFields: (fields: SignatureField[] | ((prev: SignatureField[]) => SignatureField[])) => void;
  fetchDocuments: () => Promise<void>;
  selectDocument: (doc: Document) => Promise<void>;
  uploadDocument: (file: File) => Promise<Document | null>;
  saveCurrentFields: () => Promise<void>;
  signAndExport: (options?: { signerEmail?: string; signerName?: string; addAuditPage?: boolean }) => Promise<any>;
  deleteDocument: (id: string) => Promise<void>;
  clearSelection: () => void;
  resetStore: () => void;
}

let autoSaveFieldsTimeout: any = null;

function debouncedAutoSaveFields(docId: string, fields: SignatureField[]) {
  if (autoSaveFieldsTimeout) clearTimeout(autoSaveFieldsTimeout);
  autoSaveFieldsTimeout = setTimeout(() => {
    documentService.saveFields(docId, fields, false);
  }, 400);
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  selectedDoc: null,
  fields: [],
  activeTab: 'dashboard',
  filter: 'to_sign',
  searchQuery: '',
  isLoading: false,
  isSigningLoading: false,

  setActiveTab: (activeTab) => set({ activeTab }),
  setFilter: (filter) => set({ filter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setFields: (fields) => {
    if (typeof fields === 'function') {
      set((state) => {
        const nextFields = fields(state.fields);
        if (state.selectedDoc) {
          debouncedAutoSaveFields(state.selectedDoc.id, nextFields);
        }
        return { fields: nextFields };
      });
    } else {
      const { selectedDoc } = get();
      if (selectedDoc) {
        debouncedAutoSaveFields(selectedDoc.id, fields);
      }
      set({ fields });
    }
  },

  fetchDocuments: async () => {
    set({ isLoading: true });
    try {
      const list = await documentService.listDocuments();
      set({ documents: list });
    } catch (err: any) {
      console.error('Failed to load documents:', err);
      useToastStore.getState().showToast(err.message || 'Failed to load documents', 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  selectDocument: async (doc) => {
    set({ isLoading: true, selectedDoc: null, fields: [] });
    try {
      const details = await documentService.getDetails(doc.id);
      set({
        selectedDoc: details,
        fields: details.fields || [],
        activeTab: 'editor',
      });
    } catch (err: any) {
      console.error('Failed to select document:', err);
      useToastStore.getState().showToast(err.message || 'Failed to load document details', 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  uploadDocument: async (file) => {
    set({ isLoading: true });
    try {
      const newDoc = await documentService.upload(file);
      await get().fetchDocuments();
      await get().selectDocument(newDoc);
      useToastStore.getState().showToast('Document uploaded successfully', 'success');
      return newDoc;
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Failed to upload document', 'error');
      return null;
    } finally {
      set({ isLoading: false });
    }
  },

  saveCurrentFields: async () => {
    if (autoSaveFieldsTimeout) {
      clearTimeout(autoSaveFieldsTimeout);
      autoSaveFieldsTimeout = null;
    }
    const { selectedDoc, fields } = get();
    if (!selectedDoc) return;
    try {
      await documentService.saveFields(selectedDoc.id, fields, true);
    } catch (err: any) {
      useToastStore.getState().showToast('Failed to save field placements', 'error');
      throw err;
    }
  },

  signAndExport: async (options) => {
    const { selectedDoc, fields } = get();
    if (!selectedDoc) return;

    set({ isSigningLoading: true });
    try {
      await documentService.saveFields(selectedDoc.id, fields, true);
      const result = await documentService.signAndFlatten(selectedDoc.id, options);
      useToastStore.getState().showToast('Document signed and flattened successfully!', 'success');
      await get().fetchDocuments();
      return result;
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Failed to sign document', 'error');
      throw err;
    } finally {
      set({ isSigningLoading: false });
    }
  },

  deleteDocument: async (id) => {
    try {
      await documentService.delete(id);
      set((s) => ({
        documents: s.documents.filter((d) => d.id !== id),
        selectedDoc: s.selectedDoc?.id === id ? null : s.selectedDoc,
        activeTab: s.selectedDoc?.id === id ? 'dashboard' : s.activeTab,
      }));
      useToastStore.getState().showToast('Document deleted', 'info');
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Failed to delete document', 'error');
    }
  },

  clearSelection: () => {
    set({ selectedDoc: null, fields: [], activeTab: 'dashboard' });
  },

  resetStore: () => {
    set({
      documents: [],
      selectedDoc: null,
      fields: [],
      activeTab: 'dashboard',
      searchQuery: '',
    });
  },
}));
