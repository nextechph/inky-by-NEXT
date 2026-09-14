import React, { useState } from 'react';
import {
  Mail, Lock, Sparkles, Shield, AlertCircle, ArrowLeft,
  ArrowRight, Check, HelpCircle, ChevronDown, ChevronUp, UserCheck, User
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

interface LoginPageProps {
  onNavigateHome: () => void;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={`${className} shrink-0`} viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1' ||
   window.location.hostname === '::1');

export const LoginPage: React.FC<LoginPageProps> = ({ onNavigateHome }) => {
  const {
    user,
    isConfigured,
    isLoading,
    isGoogleLoading,
    signInWithGoogle,
    signInWithDemoGoogle,
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail,
    signOut,
  } = useAuthStore();

  const [mode, setMode] = useState<'password' | 'signup' | 'forgot'>('password');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [showConfigHelp, setShowConfigHelp] = useState(false);

  const switchMode = (newMode: 'password' | 'signup' | 'forgot') => {
    setMode(newMode);
    setAuthError(null);
    setAuthSuccess(null);
  };

  const handleGoogleSignIn = async () => {
    if (!isConfigured) {
      setShowConfigHelp(true);
      return;
    }
    await signInWithGoogle();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setAuthError('Please enter your email address.');
      return;
    }

    if (mode === 'forgot') {
      const res = await resetPasswordForEmail(cleanEmail);
      if (res.success) {
        setAuthSuccess('Password reset link sent! Check your inbox for the reset link.');
      } else {
        setAuthError(res.error || 'Failed to send reset email.');
      }
      return;
    }

    if (!password) {
      setAuthError('Please enter your password.');
      return;
    }

    if (mode === 'signup' && password.length < 6) {
      setAuthError('Password must be at least 6 characters long.');
      return;
    }

    if (mode === 'password') {
      const res = await signInWithPassword(cleanEmail, password);
      if (res.success) {
        onNavigateHome();
      } else {
        setAuthError(res.error || 'Failed to sign in. Please verify your email and password.');
      }
    } else if (mode === 'signup') {
      const res = await signUpWithPassword(cleanEmail, password, fullName.trim() || undefined);
      if (res.success) {
        if (res.session) {
          onNavigateHome();
        } else {
          setAuthSuccess(
            `Account created! A verification link was sent to ${cleanEmail}. Please check your inbox to confirm your email, then sign in.`
          );
          setMode('password');
        }
      } else {
        setAuthError(res.error || 'Failed to create account. This email may already be in use.');
      }
    }
  };

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between p-3 xs:p-4 sm:p-6 md:p-8 relative overflow-hidden safe-top safe-bottom"
      style={{
        background: 'radial-gradient(ellipse at top, #faf8f5 0%, #ede8e1 100%)',
        color: 'var(--fg)',
      }}
    >
      {/* Background organic blur spheres clipped inside viewport */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute top-[-80px] left-[-80px] w-96 h-96 rounded-full opacity-40 blur-3xl"
          style={{ background: 'var(--moss-dim)' }}
        />
        <div
          className="absolute bottom-[-100px] right-[-100px] w-[28rem] h-[28rem] rounded-full opacity-30 blur-3xl"
          style={{ background: 'rgba(193, 140, 93, 0.15)' }}
        />
      </div>

      {/* Top Bar Navigation: only shown on localhost for dev bypass */}
      {isLocalhost && (
        <header className="w-full max-w-5xl mx-auto flex items-center justify-end z-10 px-2 sm:px-4">
          <button
            type="button"
            onClick={onNavigateHome}
            className="flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 hover:scale-105 cursor-pointer"
            style={{
              background: 'rgba(255, 255, 255, 0.80)',
              border: '1px solid var(--border-light)',
              color: 'var(--fg)',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--terracotta)]">Dev Mode</span>
            <span className="text-xs font-bold">Continue as Guest</span>
            <ArrowRight style={{ height: 14, width: 14, color: 'var(--moss)' }} />
          </button>
        </header>
      )}

      {/* Main Content Area */}
      <main className="w-full max-w-md mx-auto my-auto py-4 sm:py-6 z-10 animate-slideUp flex flex-col items-center justify-center">
        <div
          className="card-organic w-full p-5 sm:p-8 md:p-9"
          style={{
            borderRadius: '2.5rem',
            background: 'rgba(255, 255, 255, 0.82)',
            backdropFilter: 'blur(16px)',
            border: '1.5px solid rgba(255, 255, 255, 0.9)',
            boxShadow: '0 25px 50px -12px rgba(44, 44, 36, 0.15)',
          }}
        >
          {user ? (
            /* Signed In State Card */
            <div className="text-center space-y-6 py-2">
              <div className="relative inline-block">
                <div
                  className="h-20 w-20 mx-auto rounded-full flex items-center justify-center overflow-hidden border-2 border-[var(--moss)] shadow-md"
                  style={{ background: 'var(--moss-dim)' }}
                >
                  {user.user_metadata?.avatar_url ? (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt="User avatar"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Shield style={{ height: 36, width: 36, color: 'var(--moss)' }} />
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-1 shadow-sm">
                  <UserCheck className="w-4 h-4 text-[var(--moss)]" />
                </div>
              </div>

              <div className="space-y-1">
                <span className="badge-moss text-[11px] font-bold uppercase tracking-wider px-3 py-1">
                  Connected & Synced
                </span>
                <h2 className="font-display text-2xl font-bold pt-2" style={{ color: 'var(--fg)' }}>
                  {user.user_metadata?.full_name || user.email?.split('@')[0]}
                </h2>
                <p className="text-xs text-[var(--fg-muted)] font-mono">{user.email}</p>
              </div>

              <div
                className="p-4 rounded-2xl text-left space-y-2 text-xs"
                style={{ background: 'var(--bg-stone)', border: '1px solid var(--border-light)' }}
              >
                <div className="flex items-center gap-2 text-[var(--moss)] font-bold">
                  <Check style={{ height: 16, width: 16 }} />
                  <span>Cloud Sync Active</span>
                </div>
                <p style={{ color: 'var(--fg-muted)' }}>
                  All your uploaded documents, drawn signatures, and shareable inbox links are synchronized across your devices.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={onNavigateHome}
                  className="btn-primary w-full py-3 text-sm font-bold flex items-center justify-center gap-2"
                >
                  <span>Go to Documents</span>
                  <ArrowRight style={{ height: 16, width: 16 }} />
                </button>
                <button
                  type="button"
                  onClick={signOut}
                  className="btn-outline w-full py-3 text-sm text-rose-600 hover:bg-rose-50 border-rose-200"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            /* Sign In Form */
            <div className="space-y-6">
              {/* Header Title */}
              <div className="text-center space-y-2">
                <div
                  className="h-16 w-16 mx-auto rounded-3xl flex items-center justify-center mb-3 shadow-md"
                  style={{ background: 'var(--moss-dim)' }}
                >
                  <img
                    src="/inky-mark.png"
                    alt="Inky Logo"
                    className="h-10 w-auto object-contain"
                  />
                </div>
                <h1 className="font-display font-black text-2xl sm:text-3xl tracking-tight" style={{ color: 'var(--fg)' }}>
                  Sign in to Inky
                </h1>
                <p className="text-xs sm:text-sm" style={{ color: 'var(--fg-muted)' }}>
                  Sync contracts, signatures, and forms across your devices.
                </p>
              </div>

              {/* Primary Action: Google Sign In Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading || isGoogleLoading}
                className="w-full flex items-center justify-center gap-3.5 px-5 py-3.5 rounded-full font-bold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] outline-none select-none cursor-pointer disabled:opacity-80 disabled:cursor-wait"
                style={{
                  background: '#ffffff',
                  border: '1.5px solid var(--border)',
                  color: '#1f1f1f',
                  boxShadow: '0 4px 14px rgba(44, 44, 36, 0.08)',
                }}
              >
                {isGoogleLoading ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-[var(--moss)] border-t-transparent" />
                    <span>Connecting to Google…</span>
                  </>
                ) : (
                  <>
                    <GoogleIcon className="w-5 h-5" />
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              {/* Supabase Not Configured Helper / Alert */}
              {!isConfigured && (
                <div
                  className="rounded-2xl p-4 space-y-3"
                  style={{
                    background: 'rgba(193, 140, 93, 0.08)',
                    border: '1px solid rgba(193, 140, 93, 0.25)',
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--terracotta)' }} />
                    <div className="text-xs space-y-1">
                      <p className="font-bold" style={{ color: 'var(--terracotta)' }}>
                        Supabase OAuth Setup Needed
                      </p>
                      <p style={{ color: 'var(--fg-muted)' }}>
                        Inky is currently running in local offline mode. Add your Supabase keys to <code className="font-mono font-bold bg-black/5 px-1 rounded">.env</code> to activate live Google authentication.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[rgba(193,140,93,0.15)]">
                    <button
                      type="button"
                      onClick={() => setShowConfigHelp(!showConfigHelp)}
                      className="text-[11px] font-bold text-[var(--terracotta)] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>{showConfigHelp ? 'Hide instructions' : 'Setup instructions'}</span>
                      {showConfigHelp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {isLocalhost && (
                      <button
                        type="button"
                        onClick={signInWithDemoGoogle}
                        className="px-3 py-1 rounded-full text-[11px] font-bold transition-all hover:scale-105 cursor-pointer"
                        style={{
                          background: 'var(--moss)',
                          color: '#ffffff',
                        }}
                      >
                        Try Demo Google Sign-In
                      </button>
                    )}
                  </div>

                  {showConfigHelp && (
                    <div className="pt-2 text-xs space-y-2 border-t border-[rgba(193,140,93,0.15)] animate-fadeIn">
                      <p className="text-[11px] font-semibold text-[var(--fg)]">
                        1. In Supabase Dashboard → Authentication → Providers:
                      </p>
                      <p className="text-[11px] text-[var(--fg-muted)] pl-3">
                        Enable <strong>Google</strong> and paste your Client ID & Secret from Google Cloud Console.
                      </p>
                      <p className="text-[11px] font-semibold text-[var(--fg)]">
                        2. Add to your <code className="font-mono">.env</code> file:
                      </p>
                      <div className="p-2.5 rounded-xl bg-black/5 font-mono text-[10px] space-y-0.5 select-all overflow-x-auto">
                        <p>VITE_SUPABASE_URL=https://your-project.supabase.co</p>
                        <p>VITE_SUPABASE_ANON_KEY=your-anon-key-here</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3 my-4">
                <div className="h-[1px] flex-1 bg-[var(--border)]" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-muted)]">
                  or with email
                </span>
                <div className="h-[1px] flex-1 bg-[var(--border)]" />
              </div>

              {/* Mode Tabs */}
              <div className="flex gap-1 p-1 rounded-full bg-[var(--bg-stone)]">
                <button
                  type="button"
                  onClick={() => switchMode('password')}
                  className="flex-1 py-1.5 rounded-full text-xs font-bold transition-all duration-200 cursor-pointer"
                  style={{
                    background: mode === 'password' || mode === 'forgot' ? 'var(--moss)' : 'transparent',
                    color: mode === 'password' || mode === 'forgot' ? '#ffffff' : 'var(--fg-muted)',
                  }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="flex-1 py-1.5 rounded-full text-xs font-bold transition-all duration-200 cursor-pointer"
                  style={{
                    background: mode === 'signup' ? 'var(--moss)' : 'transparent',
                    color: mode === 'signup' ? '#ffffff' : 'var(--fg-muted)',
                  }}
                >
                  Register
                </button>
              </div>

              {/* Email / Password Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Error Banner */}
                {authError && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2 animate-fadeIn">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                    <span className="leading-snug">{authError}</span>
                  </div>
                )}

                {/* Success Banner */}
                {authSuccess && (
                  <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2 animate-fadeIn">
                    <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                    <span className="leading-snug">{authSuccess}</span>
                  </div>
                )}

                <div className="space-y-3">
                  {/* Full Name for Registration */}
                  {mode === 'signup' && (
                    <div className="animate-fadeIn">
                      <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg-muted)' }}>
                        Full Name <span className="text-[10px] font-normal text-[var(--fg-subtle)]">(Optional)</span>
                      </label>
                      <div className="relative">
                        <User
                          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          style={{ height: 15, width: 15, color: 'var(--fg-muted)' }}
                        />
                        <input
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Jane Doe"
                          className="input-organic pl-10 h-11 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {/* Email Field */}
                  <div>
                    <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--fg-muted)' }}>
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        style={{ height: 15, width: 15, color: 'var(--fg-muted)' }}
                      />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@domain.com"
                        className="input-organic pl-10 h-11 text-xs"
                      />
                    </div>
                  </div>

                  {/* Password Field (hidden in 'forgot' mode) */}
                  {mode !== 'forgot' ? (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold" style={{ color: 'var(--fg-muted)' }}>
                          Password
                        </label>
                        {mode === 'password' && (
                          <button
                            type="button"
                            onClick={() => switchMode('forgot')}
                            className="text-[11px] font-bold text-[var(--moss)] hover:underline cursor-pointer"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock
                          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          style={{ height: 15, width: 15, color: 'var(--fg-muted)' }}
                        />
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className="input-organic pl-10 h-11 text-xs"
                        />
                      </div>
                      {mode === 'signup' && (
                        <p className="text-[10px] text-[var(--fg-subtle)] mt-1 pl-1">
                          Must be at least 6 characters.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--fg-muted)]">
                      We will send a password reset link to your email address.
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary w-full h-11 flex items-center justify-center gap-2 text-sm font-bold shadow-md cursor-pointer"
                >
                  {isLoading ? (
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  ) : (
                    <>
                      <span>
                        {mode === 'password' && 'Sign In'}
                        {mode === 'signup' && 'Create Account'}
                        {mode === 'forgot' && 'Send Reset Link'}
                      </span>
                      <ArrowRight style={{ height: 15, width: 15 }} />
                    </>
                  )}
                </button>

                {mode === 'forgot' && (
                  <button
                    type="button"
                    onClick={() => switchMode('password')}
                    className="text-xs font-bold text-[var(--moss)] hover:underline flex items-center justify-center gap-1 mx-auto pt-1 cursor-pointer"
                  >
                    <ArrowLeft style={{ height: 13, width: 13 }} />
                    <span>Back to Sign In</span>
                  </button>
                )}
              </form>

              <p className="text-[11px] text-center" style={{ color: 'var(--fg-muted)' }}>
                By continuing, you agree to Inky's local-first privacy policy. Signatures and PDFs stay securely stored on your devices.
              </p>

              {isLocalhost && (
                <div className="text-center pt-1 border-t border-[var(--border-light)]">
                  <button
                    type="button"
                    onClick={onNavigateHome}
                    className="text-xs font-bold text-[var(--fg-muted)] hover:text-[var(--moss)] hover:underline transition-colors py-1 cursor-pointer"
                  >
                    Skip for now — Continue as Guest (Offline Mode) →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full text-center py-4 z-10">
        <p className="text-[11px] font-medium" style={{ color: 'var(--fg-muted)' }}>
          Inky · Client-Side E-Signature & Document Workspace
        </p>
      </footer>
    </div>
  );
};
