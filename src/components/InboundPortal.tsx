import React, { useEffect, useState } from 'react';
import { Upload, FileText, CheckCircle2, ShieldCheck, FileCheck, ArrowRight, Leaf } from 'lucide-react';
import { inboxService } from '../services/inboxService';
import { useToastStore } from '../store/useToastStore';

interface InboundPortalProps {
  token: string;
}

export const InboundPortal: React.FC<InboundPortalProps> = ({ token }) => {
  const [linkInfo, setLinkInfo] = useState<{
    valid: boolean; title?: string; note?: string; error?: string;
  } | null>(null);
  const [file, setFile]           = useState<File | null>(null);
  const [senderName, setSenderName]   = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [docTitle, setDocTitle]   = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedResult, setSubmittedResult] = useState<any | null>(null);

  useEffect(() => {
    inboxService.validateToken(token)
      .then(setLinkInfo)
      .catch((err) => setLinkInfo({ valid: false, error: err.message }));
  }, [token]);

  if (!linkInfo) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'var(--bg)' }}
      >
        <span
          className="animate-spin rounded-full h-10 w-10 border-2 border-t-transparent"
          style={{ borderColor: 'var(--moss)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (!linkInfo.valid) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'var(--bg)' }}
      >
        <div
          className="card-organic max-w-md w-full p-10 text-center space-y-5"
          style={{ borderRadius: '2.5rem' }}
        >
          <div
            className="h-16 w-16 rounded-[1.5rem] flex items-center justify-center mx-auto"
            style={{ background: 'rgba(168,84,72,0.10)' }}
          >
            <FileText style={{ height: 28, width: 28, color: '#A85448' }} />
          </div>
          <div>
            <h3 className="font-display font-bold text-xl" style={{ color: 'var(--fg)' }}>
              Link Unavailable
            </h3>
            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              {linkInfo.error || 'This upload link is expired or no longer active.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      useToastStore.getState().showToast('Please select a PDF document to upload', 'warning');
      return;
    }
    if (!senderName.trim() || !senderEmail.trim()) {
      useToastStore.getState().showToast('Please enter your name and email address', 'warning');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await inboxService.submitInbound(token, file, senderName, senderEmail, docTitle);
      setSubmittedResult(res);
      useToastStore.getState().showToast('Document submitted successfully', 'success');
    } catch (err: any) {
      useToastStore.getState().showToast(err.message || 'Failed to submit document', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 font-sans"
      style={{ background: 'var(--bg)' }}
    >
      {/* Ambient blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute animate-blobFloat"
          style={{
            width: 420, height: 360,
            top: -80, left: -100,
            background: 'radial-gradient(circle, #5D7052 0%, transparent 70%)',
            filter: 'blur(72px)',
            opacity: 0.25,
          }}
        />
        <div
          className="absolute animate-blobFloat2"
          style={{
            width: 360, height: 320,
            bottom: -60, right: -80,
            background: 'radial-gradient(circle, #C18C5D 0%, transparent 70%)',
            filter: 'blur(72px)',
            opacity: 0.20,
          }}
        />
      </div>

      <div
        className="card-organic max-w-lg w-full overflow-hidden relative z-10"
        style={{ borderRadius: '2.5rem' }}
      >
        {/* Header */}
        <div
          className="glass p-5 sm:p-8 text-center space-y-2"
          style={{ borderBottom: '1px solid var(--border-light)' }}
        >
          <div
            className="h-14 w-14 rounded-[1.5rem] flex items-center justify-center mx-auto mb-3 sm:mb-4"
            style={{ background: 'var(--moss-dim)' }}
          >
            <FileCheck style={{ height: 26, width: 26, color: 'var(--moss)' }} />
          </div>
          <h2 className="font-display font-bold text-xl sm:text-2xl" style={{ color: 'var(--fg)' }}>
            {linkInfo.title || 'Upload Document for Signature'}
          </h2>
          {linkInfo.note && (
            <p className="text-sm max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              {linkInfo.note}
            </p>
          )}
        </div>

        {/* Body */}
        <div className="p-5 sm:p-8">
          {!submittedResult ? (
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              {/* Drop zone */}
              <div
                className="rounded-[1.75rem] p-5 sm:p-8 text-center space-y-3 transition-all duration-300 hover:scale-[1.01]"
                style={{
                  background: file ? 'var(--moss-dim)' : 'rgba(255,255,255,0.60)',
                  border: `2px dashed ${file ? 'var(--moss)' : 'rgba(93,112,82,0.30)'}`,
                  boxShadow: 'inset 0 2px 12px rgba(44,44,36,0.05)',
                }}
              >
                <div
                  className="h-12 w-12 rounded-2xl flex items-center justify-center mx-auto transition-all duration-300"
                  style={{ background: file ? 'rgba(93,112,82,0.20)' : 'var(--moss-dim)' }}
                >
                  <Upload style={{ height: 22, width: 22, color: 'var(--moss)' }} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--fg)' }}>
                    {file ? file.name : 'Select or drop your PDF here'}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                    {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'PDF up to 25MB'}
                  </p>
                </div>
                <label className="cursor-pointer">
                  <span className="btn-ghost btn-sm inline-flex">
                    {file ? 'Change PDF' : 'Browse PDF File'}
                  </span>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Optional title */}
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg)' }}>
                  Document Title <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Services Agreement 2026"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  className="input-organic"
                />
              </div>

              {/* Sender details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg)' }}>
                    Your Full Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Full name"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    className="input-organic"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg)' }}>
                    Your Email
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    className="input-organic"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !file}
                className="btn-primary w-full justify-center"
                style={{ height: '3.25rem' }}
              >
                {isSubmitting
                  ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  : <ArrowRight style={{ height: 16, width: 16 }} />
                }
                <span>Submit Document for Signing</span>
              </button>
            </form>
          ) : (
            <div className="text-center py-6 space-y-5 animate-fadeIn">
              <div
                className="h-16 w-16 rounded-[1.5rem] flex items-center justify-center mx-auto"
                style={{ background: 'var(--moss-dim)' }}
              >
                <CheckCircle2 style={{ height: 30, width: 30, color: 'var(--moss)' }} />
              </div>
              <div>
                <h3 className="font-display font-bold text-2xl" style={{ color: 'var(--fg)' }}>
                  Submitted!
                </h3>
                <p className="text-sm mt-1.5 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  Your document is in the signing queue. You'll receive a confirmation once it's been signed.
                </p>
              </div>
              <div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold"
                style={{ background: 'var(--moss-dim)', color: 'var(--moss)' }}
              >
                <Leaf style={{ height: 13, width: 13 }} />
                <span>Paperless & Secure</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 text-center"
          style={{ borderTop: '1px solid var(--border-light)', background: 'var(--bg-stone)' }}
        >
          <span
            className="text-[11px] flex items-center justify-center gap-1.5 font-semibold"
            style={{ color: 'var(--fg-muted)' }}
          >
            <ShieldCheck style={{ height: 13, width: 13, color: 'var(--moss)' }} />
            <span>End-to-end encrypted · E-Sign App</span>
          </span>
        </div>
      </div>
    </div>
  );
};
