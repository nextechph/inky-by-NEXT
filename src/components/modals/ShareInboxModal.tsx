import React, { useState } from 'react';
import { X, Inbox, Copy, Check, Link } from 'lucide-react';
import { inboxService } from '../../services/inboxService';
import { InboxLink } from '../../types';
import { useToastStore } from '../../store/useToastStore';
import { Dropdown } from '../ui/Dropdown';

interface ShareInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EXPIRATION_OPTIONS = [
  { value: 24,  label: '24 Hours', sublabel: '1 Day' },
  { value: 72,  label: '3 Days' },
  { value: 168, label: '7 Days', sublabel: '1 Week' },
  { value: 720, label: '30 Days', sublabel: '1 Month' },
];

const MAX_USES_OPTIONS = [
  { value: 1,  label: '1 Submission', sublabel: 'Single use' },
  { value: 5,  label: '5 Submissions' },
  { value: 20, label: '20 Submissions' },
];

export const ShareInboxModal: React.FC<ShareInboxModalProps> = ({ isOpen, onClose }) => {
  const [title, setTitle]             = useState('Send document for my signature');
  const [note, setNote]               = useState('Please upload the contract or agreement here.');
  const [expiresHours, setExpiresHours] = useState(168);
  const [maxUses, setMaxUses]         = useState(5);
  const [generatedLink, setGeneratedLink] = useState<InboxLink | null>(null);
  const [copied, setCopied]           = useState(false);
  const [isLoading, setIsLoading]     = useState(false);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const link = await inboxService.createLink({ title, note, expiresHours, maxUses });
      setGeneratedLink(link);
      useToastStore.getState().showToast('Inbox link created successfully', 'success');
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Failed to create link', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fullUrl = generatedLink
    ? `${window.location.origin}/inbox-submit/${generatedLink.token}`
    : '';

  const handleCopy = () => {
    if (fullUrl) {
      navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 animate-fadeIn"
      style={{ background: 'rgba(44,44,36,0.50)', backdropFilter: 'blur(10px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="card-organic max-w-md w-full max-h-[92vh] flex flex-col overflow-hidden animate-slideUp rounded-[1.75rem] sm:rounded-[2.5rem]"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border-light)' }}
        >
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div
              className="h-8 sm:h-9 w-8 sm:w-9 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--moss-dim)' }}
            >
              <Inbox style={{ height: 16, width: 16, color: 'var(--moss)' }} />
            </div>
            <h3 className="font-display font-bold text-base sm:text-lg" style={{ color: 'var(--fg)' }}>
              Shareable Inbox Link
            </h3>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
            style={{ background: 'var(--bg-stone)', color: 'var(--fg-muted)' }}
            aria-label="Close"
          >
            <X style={{ height: 14, width: 14 }} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
          {!generatedLink ? (
            <>
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg)' }}>
                  Link Purpose / Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input-organic text-sm"
                  placeholder="E.g., Freelance Contract Upload"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg)' }}>
                  Instructions for Sender
                </label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="textarea-organic"
                  placeholder="Instructions shown to the uploader…"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Dropdown
                    label="Expiration"
                    value={expiresHours}
                    onChange={(val) => setExpiresHours(Number(val))}
                    options={EXPIRATION_OPTIONS}
                    direction="up"
                  />
                </div>
                <div>
                  <Dropdown
                    label="Max Submissions"
                    value={maxUses}
                    onChange={(val) => setMaxUses(Number(val))}
                    options={MAX_USES_OPTIONS}
                    direction="up"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4 animate-fadeIn">
              {/* Success banner */}
              <div
                className="p-4 rounded-[1.5rem] flex items-start gap-3"
                style={{ background: 'var(--moss-dim)', border: '1px solid rgba(93,112,82,0.22)' }}
              >
                <Check style={{ height: 18, width: 18, color: 'var(--moss)', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--moss)' }}>Link Ready</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                    Share with the sender — they can upload without an account.
                  </p>
                </div>
              </div>

              {/* URL display */}
              <div
                className="p-4 rounded-[1.5rem] space-y-2"
                style={{ background: 'var(--bg-stone)', border: '1px solid var(--border-light)' }}
              >
                <span
                  className="text-[10px] font-bold uppercase tracking-wider block"
                  style={{ color: 'var(--fg-subtle)' }}
                >
                  Shareable URL
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-xs font-mono select-all truncate"
                    style={{ color: 'var(--fg)' }}
                  >
                    {fullUrl}
                  </span>
                  <button
                    onClick={handleCopy}
                    className="btn-primary btn-sm shrink-0"
                    aria-label="Copy link"
                  >
                    {copied ? <Check style={{ height: 13, width: 13 }} /> : <Copy style={{ height: 13, width: 13 }} />}
                    <span>{copied ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-0 flex items-center justify-end gap-3">
          {!generatedLink ? (
            <>
              <button
                onClick={onClose}
                className="btn-ghost"
                style={{ color: 'var(--fg-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={isLoading}
                className="btn-primary"
              >
                {isLoading
                  ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  : <Link style={{ height: 14, width: 14 }} />
                }
                <span>Generate Link</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => { setGeneratedLink(null); onClose(); }}
              className="btn-primary"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
