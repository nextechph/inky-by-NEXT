import React, { useState } from 'react';
import {
  History,
  FileCheck,
  Search,
  ExternalLink,
  Trash2,
  ArrowRight,
  ShieldCheck,
  PenTool,
  Download,
} from 'lucide-react';
import { Document } from '../types';
import * as storage from '../lib/storage';
import { downloadBlob, formatDateTime } from '../utils';
import { flattenPdfSignatures } from '../lib/pdf';

interface HistoryViewProps {
  documents: Document[];
  onSelectDocument?: (doc: Document) => void;
  onDeleteDocument: (id: string) => void;
  onGoToQueue: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  documents,
  onSelectDocument,
  onDeleteDocument,
  onGoToQueue,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const signedDocs = documents.filter((d) => d.status === 'completed');

  const filteredDocs = signedDocs.filter((d) => {
    const q = searchQuery.toLowerCase();
    return d.title.toLowerCase().includes(q) || d.originalFileName.toLowerCase().includes(q);
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

  const handleViewSigned = async (doc: Document, e: React.MouseEvent) => {
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
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full animate-fadeIn pb-12">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display font-bold text-2xl" style={{ color: 'var(--fg)' }}>
              Document History
            </h2>
            <span className="badge-moss text-xs font-bold px-2.5 py-0.5 rounded-full">
              {signedDocs.length} signed
            </span>
          </div>
          <p className="text-sm mt-0.5" style={{ color: 'var(--fg-muted)' }}>
            All exported documents with flattened signatures and audit verification
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search
            className="absolute left-3.5 top-1/2 -translate-y-1/2"
            style={{ height: 14, width: 14, color: 'var(--fg-muted)' }}
          />
          <input
            type="search"
            placeholder="Search history…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-organic pl-9 h-10 text-sm"
            aria-label="Search history"
          />
        </div>
      </div>

      {/* ── Document List ─────────────────────────────────── */}
      <div className="space-y-3">
        {filteredDocs.length === 0 ? (
          <div className="card-organic rounded-[2.5rem] px-5 py-12 text-center flex flex-col items-center justify-center space-y-4">
            <div
              className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: 'var(--moss-dim)' }}
            >
              <History style={{ height: 24, width: 24, color: 'var(--moss)' }} />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg" style={{ color: 'var(--fg)' }}>
                {searchQuery ? 'No matching documents' : 'No signed documents yet'}
              </h3>
              <p className="text-sm mt-1 max-w-xs mx-auto" style={{ color: 'var(--fg-muted)' }}>
                {searchQuery
                  ? 'Try a different search term.'
                  : 'Documents you sign and download will appear here with verification proofs.'}
              </p>
            </div>
            {!searchQuery && (
              <button onClick={onGoToQueue} className="btn-primary btn-sm">
                <span>Go to Signing Queue</span>
                <ArrowRight style={{ height: 13, width: 13 }} />
              </button>
            )}
          </div>
        ) : (
          filteredDocs.map((doc) => (
            <div
              key={doc.id}
              onClick={() => onSelectDocument && onSelectDocument(doc)}
              className="card-organic rounded-[1.75rem] sm:rounded-[2rem] p-4 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 transition-all duration-300 group cursor-pointer hover:border-[var(--moss)] hover:shadow-md"
            >
              {/* Left: icon + metadata */}
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <div
                  className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-105"
                  style={{ background: 'var(--moss-dim)' }}
                >
                  <FileCheck style={{ height: 22, width: 22, color: 'var(--moss)' }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-sm sm:text-base truncate" style={{ color: 'var(--fg)' }}>
                      {doc.title}
                    </h4>
                    <span className="badge-moss flex items-center gap-1">
                      <ShieldCheck style={{ height: 12, width: 12 }} />
                      <span>Signed</span>
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                    {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}
                    {' · '}
                    {formatDateTime(doc.updatedAt || doc.createdAt)}
                  </p>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1.5 sm:gap-2 self-end sm:self-center shrink-0 flex-wrap">
                {/* Edit document button */}
                {onSelectDocument && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDocument(doc);
                    }}
                    className="btn-primary btn-sm flex items-center gap-1.5"
                    aria-label="Edit or re-sign document"
                    title="Edit fields or re-sign document"
                  >
                    <PenTool style={{ height: 13, width: 13 }} />
                    <span>Edit</span>
                  </button>
                )}

                {/* Download signed PDF */}
                <button
                  onClick={(e) => handleDownloadSigned(doc, e)}
                  className="btn-outline btn-sm flex items-center gap-1.5"
                  aria-label="Download signed document"
                  title="Download signed PDF"
                >
                  <Download style={{ height: 13, width: 13 }} />
                  <span>Download</span>
                </button>

                {/* View signed PDF */}
                <button
                  onClick={(e) => handleViewSigned(doc, e)}
                  className="btn-ghost btn-sm flex items-center gap-1.5"
                  aria-label="Open signed document"
                  title="View PDF in new tab"
                >
                  <ExternalLink style={{ height: 13, width: 13 }} />
                  <span>View</span>
                </button>

                {/* Delete document */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDocument(doc.id);
                  }}
                  className="p-2 rounded-xl transition-all duration-200 hover:scale-110"
                  style={{ color: 'var(--fg-muted)' }}
                  aria-label="Delete document"
                  title="Delete from history"
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
