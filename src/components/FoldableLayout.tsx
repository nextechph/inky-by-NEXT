import React, { useState, useEffect } from 'react';
import {
  Inbox,
  FileText,
  PenTool,
  PlusCircle,
  History,
  Share2,
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { AppTab } from '../types';

interface FoldableLayoutProps {
  children: React.ReactNode;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  onUploadClick: () => void;
  onGenerateInboxClick: () => void;
  onNavigateLogin?: () => void;
  unreadNotificationCount?: number;
}

// Ambient background blob — brings depth and organic atmosphere
const Blob = ({ style, delay = '0s' }: { style: React.CSSProperties; delay?: string }) => (
  <div
    aria-hidden
    className="pointer-events-none absolute animate-blobFloat select-none"
    style={{ animationDelay: delay, filter: 'blur(72px)', opacity: 0.38, ...style }}
  />
);

export const FoldableLayout: React.FC<FoldableLayoutProps> = ({
  children,
  activeTab,
  setActiveTab,
  onUploadClick,
  onGenerateInboxClick,
  onNavigateLogin,
  unreadNotificationCount = 0,
}) => {
  const { user, openAuthModal } = useAuthStore();
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isFoldCover = windowWidth <= 450;

  const navItems = [
    { id: 'dashboard',  icon: FileText, label: 'Queue'      },
    { id: 'history',    icon: History,  label: 'History'    },
    { id: 'signatures', icon: PenTool,  label: 'Signatures' },
    { id: 'inbox',      icon: Inbox,    label: 'Inbox'      },
  ] as const;

  return (
    <div className={`${activeTab === 'editor' ? 'h-[100dvh] max-h-[100dvh] overflow-hidden' : 'min-h-[100dvh]'} flex flex-col w-full max-w-full overflow-x-hidden`} style={{ background: 'var(--bg)' }}>

      {/* ── Ambient Blob Layer ──────────────────────────────── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <Blob
          delay="0s"
          style={{
            width: 520, height: 420,
            top: -80, left: -120,
            background: 'radial-gradient(circle, #5D7052 0%, transparent 70%)',
          }}
        />
        <Blob
          delay="4s"
          style={{
            width: 440, height: 380,
            bottom: 0, right: -100,
            background: 'radial-gradient(circle, #C18C5D 0%, transparent 70%)',
          }}
        />
      </div>

      {/* ── Top Navigation (floating pill) ─────────────────── */}
      <header className="sticky top-0 z-40 px-2 sm:px-3 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-1.5">
        <nav
          className={`glass rounded-full ${activeTab === 'editor' ? 'max-w-6xl' : 'max-w-5xl'} mx-auto px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between gap-2 transition-all`}
          role="navigation"
          aria-label="Main navigation"
        >
          <div className="flex items-center gap-2 select-none cursor-default shrink-0">
            <img
              src="/inky-mark.png"
              alt="Inky Logo"
              className="h-8 sm:h-8.5 w-auto object-contain pointer-events-none"
              style={{ height: '32px' }}
            />
            <img
              src="/inky-wordmark.png"
              alt="Inky"
              className="h-5.5 sm:h-6 w-auto object-contain hidden xs:block pointer-events-none"
              style={{ height: '22px' }}
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={onGenerateInboxClick}
              className="btn-ghost btn-sm !px-2.5 sm:!px-4"
              aria-label="Create inbox link"
              title="Create shareable inbox link"
            >
              <Share2 style={{ height: 14, width: 14 }} />
              <span className="hidden md:inline">Inbox Link</span>
            </button>

            <button
              onClick={onUploadClick}
              className="btn-primary btn-sm !px-3 sm:!px-4"
              aria-label="Upload PDF document"
            >
              <PlusCircle style={{ height: 14, width: 14 }} />
              <span className="hidden xs:inline">Upload PDF</span>
              <span className="xs:hidden">Upload</span>
            </button>

            {/* Account button: displayed on the right of Upload PDF when signed in */}
            {user && (
              <button
                onClick={openAuthModal}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-bold transition-all hover:scale-105 cursor-pointer shrink-0"
                style={{
                  background: 'var(--moss-dim)',
                  color: 'var(--moss)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 2px 6px rgba(44, 44, 36, 0.04)',
                }}
                title={`Signed in as ${user.email}`}
              >
                <span className="h-2 w-2 rounded-full bg-[var(--moss)] animate-pulse shrink-0" />
                <span className="max-w-[70px] sm:max-w-[110px] truncate">
                  {user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0]}
                </span>
              </button>
            )}
          </div>
        </nav>
      </header>

      {/* ── Page Content ────────────────────────────────────── */}
      <div className={`flex flex-1 ${activeTab === 'editor' ? 'max-w-6xl min-h-0 h-full overflow-hidden' : 'max-w-5xl'} mx-auto w-full transition-all`}>

        {/* Desktop sidebar nav (hidden in editor mode to provide full-width document workspace) */}
        {activeTab !== 'editor' && (
          <nav
            className="hidden sm:flex flex-col py-6 px-3 space-y-1 w-44 shrink-0"
            aria-label="Section navigation"
          >
            {navItems.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="flex items-center gap-3 w-full px-4 py-2.5 rounded-2xl text-base font-bold transition-all duration-200 relative"
                style={{
                  background: activeTab === id ? 'var(--moss-dim)' : 'transparent',
                  color: activeTab === id ? 'var(--moss)' : 'var(--fg-muted)',
                }}
              >
                <Icon style={{ height: 18, width: 18, flexShrink: 0 }} />
                <span>{label}</span>
                {id === 'inbox' && unreadNotificationCount > 0 && (
                  <span
                    className="absolute top-1.5 right-2 flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-[10px] font-bold text-white animate-pulse"
                    style={{ background: '#C18C5D', boxShadow: '0 2px 8px rgba(193,140,93,0.5)' }}
                  >
                    {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        )}

        {/* Main content */}
        <main className={`flex-1 min-w-0 ${activeTab === 'editor' ? 'p-1 sm:px-6 sm:py-3 h-full min-h-0 flex flex-col overflow-hidden' : 'px-3 sm:px-6 py-3 sm:py-6 overflow-y-auto overflow-x-hidden'}`}>
          {children}
        </main>
      </div>

      {/* ── Mobile Bottom Nav (hidden in editor mode) ────────── */}
      {activeTab !== 'editor' && (
        <nav
          className="sticky bottom-0 z-30 sm:hidden glass border-t flex items-center justify-around px-1 pt-2 pb-[max(0.65rem,env(safe-area-inset-bottom,0px))]"
          style={{ borderColor: 'var(--border-light)' }}
          aria-label="Mobile navigation"
        >
          {navItems.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-2xl transition-all duration-200 relative min-w-[60px]"
              style={{
                color: activeTab === id ? 'var(--moss)' : 'var(--fg-muted)',
                background: activeTab === id ? 'var(--moss-dim)' : 'transparent',
              }}
            >
              <Icon style={{ height: 20, width: 20 }} />
              <span className="text-[10px] font-bold tracking-tight">{label}</span>
              {id === 'inbox' && unreadNotificationCount > 0 && (
                <span
                  className="absolute top-0 right-2 flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[9px] font-bold text-white shadow-xs"
                  style={{ background: '#C18C5D' }}
                >
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
};
