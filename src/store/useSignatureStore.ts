// Inky Signature Store (matching Worklane src/store pattern)
import { create } from 'zustand';
import { SavedSignature } from '../types';
import { signatureService } from '../services/signatureService';
import { useToastStore } from './useToastStore';

interface SignatureState {
  signatures: SavedSignature[];
  isSigModalOpen: boolean;
  targetFieldId?: string;
  initialSignature?: string;

  // Actions
  loadSignatures: () => void;
  openSignatureModal: (fieldId?: string, initialSignature?: string) => void;
  closeSignatureModal: () => void;
  addSignature: (dataUrl: string, type: 'draw' | 'type' | 'upload', label?: string, isDefault?: boolean) => SavedSignature;
  removeSignature: (id: string) => void;
  makeDefault: (id: string) => void;
  renameSignature: (id: string, label: string) => void;
}

export const useSignatureStore = create<SignatureState>((set, get) => ({
  signatures: [],
  isSigModalOpen: false,
  targetFieldId: undefined,
  initialSignature: undefined,

  loadSignatures: async () => {
    const list = signatureService.getSignatures();
    set({ signatures: list });
    try {
      const cloudList = await signatureService.loadFromCloud();
      if (cloudList && cloudList.length > 0) {
        set({ signatures: cloudList });
      }
    } catch (e) {
      // Offline or local mode
    }
  },

  openSignatureModal: (fieldId, initialSignature) => {
    set({ isSigModalOpen: true, targetFieldId: fieldId, initialSignature });
  },

  closeSignatureModal: () => {
    set({ isSigModalOpen: false, targetFieldId: undefined, initialSignature: undefined });
  },

  addSignature: (dataUrl, type, label = 'My Signature', isDefault = false) => {
    const newSig = signatureService.saveSignature({
      type,
      dataUrl,
      label,
      isDefault: isDefault || get().signatures.length === 0,
    });
    get().loadSignatures();
    useToastStore.getState().showToast('Signature saved to device', 'success');
    return newSig;
  },

  removeSignature: (id) => {
    signatureService.deleteSignature(id);
    get().loadSignatures();
    useToastStore.getState().showToast('Signature removed', 'info');
  },

  makeDefault: (id) => {
    signatureService.setDefaultSignature(id);
    get().loadSignatures();
    useToastStore.getState().showToast('Default signature updated', 'success');
  },

  renameSignature: (id, label) => {
    signatureService.renameSignature(id, label);
    get().loadSignatures();
    useToastStore.getState().showToast('Signature renamed', 'success');
  },
}));
