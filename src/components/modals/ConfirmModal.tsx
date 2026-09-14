import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-md rounded-[1.75rem] sm:rounded-[2.5rem] p-5 sm:p-7 shadow-2xl"
          style={{
            background: 'var(--surface)',
            border: '1.5px solid var(--border)',
            boxShadow: '0 25px 60px -15px rgba(44,44,36,0.35)',
          }}
        >
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 sm:top-5 sm:right-5 h-8 w-8 rounded-full flex items-center justify-center transition-all hover:scale-110"
            style={{ background: 'var(--bg-stone)', color: 'var(--fg-muted)' }}
          >
            <X size={16} />
          </button>

          <div className="flex items-start gap-3 sm:gap-4">
            <div
              className="p-2.5 sm:p-3 rounded-2xl flex-shrink-0"
              style={{
                background: isDestructive ? 'rgba(168,84,72,0.12)' : 'var(--moss-dim)',
                color: isDestructive ? '#A85448' : 'var(--moss)',
              }}
            >
              <AlertTriangle size={22} />
            </div>
            <div className="min-w-0 pr-6">
              <h3 className="text-base sm:text-lg font-bold font-display" style={{ color: 'var(--fg)' }}>{title}</h3>
              <p className="mt-1 text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>{message}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse xs:flex-row items-stretch xs:items-center justify-end gap-2 sm:gap-3">
            <button
              onClick={onCancel}
              className="px-5 py-2.5 rounded-full text-xs font-bold border transition-all hover:scale-105 text-center"
              style={{
                background: 'var(--bg-stone)',
                borderColor: 'var(--border)',
                color: 'var(--fg)',
              }}
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className="px-5 py-2.5 rounded-full text-xs font-bold text-white transition-all hover:scale-105 shadow-md text-center"
              style={{
                background: isDestructive ? '#A85448' : 'var(--moss)',
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
