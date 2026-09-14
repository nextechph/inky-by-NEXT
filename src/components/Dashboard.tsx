import React, { useState } from 'react';
import {
  FileText,
  PlusCircle,
  Search,
  Inbox,
  Download,
  Trash2,
  ChevronRight,
  PenTool,
  Share2,
} from 'lucide-react';
import { Document } from '../types';
import * as storage from '../lib/storage';
import { downloadBlob, formatDateTime } from '../utils';
import { flattenPdfSignatures } from '../lib/pdf';

interface DashboardViewProps {
  documents: Document[];
  onSelectDocument: (doc: Document) => void;
  onUploadClick: () => void;
  onGenerateInboxClick: () => void;
  onDeleteDocument: (id: string) => void;
}



export const DashboardView: React.FC<DashboardViewProps> = ({
  documents,
  onSelectDocument,
  onUploadClick,
  onGenerateInboxClick,
  onDeleteDocument,
}) => {
  const [activeFilter, setActiveFilter] = useState<'to_sign' | 'pending' | 'completed'>('to_sign');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDocs = documents.filter((d) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = d.title.toLowerCase().includes(q) || d.originalFileName.toLowerCase().includes(q);
    if (!matchSearch) return false;
    if (activeFilter === 'to_sign')   return d.status === 'draft' || (d.status === 'pending' && d.source === 'inbound');
    if (activeFilter === 'pending')   return (d.status === 'pending' || d.status === 'sent') && d.source !== 'inbound';
    if (activeFilter === 'completed') return d.status === 'completed';
    return true;
  });

  const handleDownloadSigned = async (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();
    let signedBytes = await storage.getSignedPdfBytes(doc.id);
    if (!signedBytes) {
      const bytes = await storage.getOriginalPdfBytes(doc.id);
      if (bytes) {
        const fields = storage.getLocalDocumentFields(doc.id);
        if (fields.some((f) => !!f.value)) {
          try {
            signedBytes = await flattenPdfSignatures(bytes, fields);
            await storage.storeSignedPdfBytes(doc.id, signedBytes);
          } catch (err) {
            console.warn('Failed to flatten signatures on the fly:', err);
            signedBytes = bytes;
          }
        } else {
          signedBytes = bytes;
        }
      }
    }
    if (signedBytes) {
      const blob = new Blob([signedBytes as any], { type: 'application/pdf' });
      downloadBlob(blob, `${doc.title.replace(/\.pdf$/i, '').replace(/\s+/g, '_')}_signed.pdf`);
    }
  };

  const docStatusBadge = (doc: Document) => {
    if (doc.status === 'completed') return <span className="badge-moss">Signed</span>;
    if ((doc.status === 'pending' || doc.status === 'sent') && doc.source !== 'inbound') return <span className="badge-clay">Sent</span>;
    if (doc.source === 'inbound') return <span className="badge-stone">Inbound</span>;
    return <span className="badge-stone">Draft</span>;
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-10">



      {/* ── Search + Filter toolbar ──────────────────────────── */}
      <div className="glass rounded-[2.5rem] px-4 py-3 flex flex-col sm:flex-row items-center gap-3">
        {/* Search pill */}
        <div className="relative w-full sm:w-72">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2"
            style={{ height: 14, width: 14, color: 'var(--fg-muted)' }}
          />
          <input
            type="search"
            placeholder="Search documents…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-organic pl-10 h-11 text-base"
            aria-label="Search documents"
          />
        </div>

        {/* Filter pills — non-scrollable, responsive pill segment */}
        <div className="flex items-center gap-1 sm:gap-2 w-full sm:w-auto p-1 rounded-full bg-[var(--bg-stone)] sm:bg-transparent no-scrollbar">
          {[
            { id: 'to_sign',   label: 'Drafts' },
            { id: 'pending',   label: 'Sent'   },
            { id: 'completed', label: 'Recent' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id as any)}
              className="flex-1 sm:flex-initial text-center px-2.5 xs:px-3 sm:px-5 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all duration-200"
              style={{
                background: activeFilter === tab.id ? 'var(--moss)' : 'transparent',
                color: activeFilter === tab.id ? '#F3F4F1' : 'var(--fg-muted)',
                boxShadow: activeFilter === tab.id ? '0 4px 14px rgba(93,112,82,0.20)' : 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Document List ────────────────────────────────────── */}
      <div className="space-y-3">
        {filteredDocs.length === 0 ? (
          <div
            className="card-organic rounded-[2.5rem] px-5 py-10 sm:p-16 text-center flex flex-col items-center justify-center space-y-5 w-full"
          >
            {/* Ambient blob behind icon */}
            <div className="relative inline-block mx-auto">
              <div
                className="absolute inset-0 rounded-full blur-2xl"
                style={{ background: 'var(--moss-dim)', transform: 'scale(1.8)' }}
                aria-hidden
              />
              <div
                className="relative h-16 w-16 rounded-3xl flex items-center justify-center mx-auto"
                style={{ background: 'var(--moss-dim)' }}
              >
                <FileText style={{ height: 28, width: 28, color: 'var(--moss)' }} />
              </div>
            </div>
            <div>
              <h3 className="font-display font-bold text-lg" style={{ color: 'var(--fg)' }}>
                Nothing here yet
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--fg-muted)' }}>
                Upload a PDF or share an inbox link to begin.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button onClick={onUploadClick} className="btn-primary">
                <PlusCircle style={{ height: 15, width: 15 }} />
                Upload PDF
              </button>
              <button onClick={onGenerateInboxClick} className="btn-outline">
                <Share2 style={{ height: 15, width: 15 }} />
                Inbox Link
              </button>
            </div>
          </div>
        ) : (
          filteredDocs.map((doc) => (
            <div
              key={doc.id}
              onClick={() => onSelectDocument(doc)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectDocument(doc)}
              className="card-organic rounded-[1.75rem] sm:rounded-[2rem] p-4 sm:px-5 sm:py-4 flex flex-col xs:flex-row xs:items-center justify-between gap-3 cursor-pointer transition-all duration-300 group"
            >
              {/* Left: icon + details */}
              <div className="flex items-center gap-3 sm:gap-4 min-w-0 w-full xs:w-auto">
                <div
                  className="h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-105"
                  style={{ background: 'var(--moss-dim)' }}
                >
                  <FileText style={{ height: 20, width: 20, color: 'var(--moss)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4
                      className="font-bold text-sm truncate"
                      style={{ color: 'var(--fg)' }}
                    >
                      {doc.title}
                    </h4>
                    {docStatusBadge(doc)}
                  </div>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                    {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}
                    {' · '}
                    {formatDateTime(doc.status === 'sent' || doc.status === 'completed' ? (doc.updatedAt || doc.createdAt) : doc.createdAt)}
                  </p>
                </div>
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-2 shrink-0 self-end xs:self-center ml-0 xs:ml-3">
                {doc.status === 'completed' ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDocument(doc);
                      }}
                      className="btn-primary btn-sm flex items-center gap-1.5"
                      aria-label="Edit signed document"
                      title="Edit fields or re-sign document"
                    >
                      <PenTool style={{ height: 13, width: 13 }} />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={(e) => handleDownloadSigned(doc, e)}
                      className="btn-outline btn-sm flex items-center gap-1.5"
                      aria-label="Download signed document"
                      title="Download signed PDF"
                    >
                      <Download style={{ height: 13, width: 13 }} />
                      <span>Download</span>
                    </button>
                  </>
                ) : (
                  <button
                    className="btn-primary btn-sm"
                    onClick={(e) => { e.stopPropagation(); onSelectDocument(doc); }}
                  >
                    <span>Sign</span>
                    <ChevronRight style={{ height: 14, width: 14 }} />
                  </button>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDocument(doc.id);
                  }}
                  className="p-2 rounded-xl transition-all duration-200 hover:scale-110"
                  style={{ color: 'var(--fg-muted)' }}
                  aria-label="Delete document"
                  title="Delete document"
                >
                  <Trash2 style={{ height: 16, width: 16 }} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const Dashboard = DashboardView;
