import React, { useState, useRef, useEffect, useCallback } from 'react';
import { projectId, publicAnonKey } from '/utils/supabase/info';

const API = `https://${projectId}.supabase.co/functions/v1/make-server-3e538714`;

export interface SessionInfo {
  access_token: string;
  user: { email: string; id: string };
}

interface AuthGateProps {
  onSession: (s: SessionInfo) => void;
  onGuest: () => void;
}

export function AuthGate({ onSession, onGuest }: AuthGateProps) {
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startTimer = () => {
    setCountdown(30);
    timerRef.current = setInterval(() => setCountdown(c => { if (c <= 1) { clearInterval(timerRef.current!); return 0; } return c - 1; }), 1000);
  };

  const sendOtp = useCallback(async (addr = email) => {
    if (!addr.includes('@')) { setError('Enter a valid email'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${publicAnonKey}` },
        body: JSON.stringify({ email: addr }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to send code');
      setStep('otp'); startTimer();
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }, [email]);

  const verifyOtp = async () => {
    const code = otp.join('');
    if (code.length < 6) { setError('Enter the full 6-digit code'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${publicAnonKey}` },
        body: JSON.stringify({ email, token: code }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Invalid or expired code');
      onSession(d.session);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } finally { setLoading(false); }
  };

  const handleOtpChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp]; next[i] = digit; setOtp(next);
    if (digit && i < 5) otpRefs.current[i + 1]?.focus();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-sm bg-black/20" />
      <div className="relative bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3 bg-primary">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="8" cy="8" r="3" fill="white" /><circle cx="16" cy="8" r="3" fill="white" />
              <circle cx="8" cy="16" r="3" fill="white" /><circle cx="16" cy="16" r="3" fill="white" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-foreground">Sign in to Dotlet</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === 'email' ? 'Enter your email to get started' : `Code sent to ${email}`}
          </p>
        </div>

        {step === 'email' ? (
          <>
            <input type="email" placeholder="you@example.com" value={email}
              onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendOtp()}
              autoFocus className="w-full border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors" />
            {error && <p className="text-destructive text-xs mt-2">{error}</p>}
            <button onClick={() => sendOtp()} disabled={loading}
              className="mt-4 w-full py-3 rounded-xl text-sm font-medium text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-50 transition-opacity">
              {loading ? 'Sending…' : 'Send code'}
            </button>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <button onClick={onGuest}
              className="mt-3 w-full py-3 rounded-xl text-sm text-muted-foreground border border-border hover:bg-secondary transition-colors">
              Continue without account
            </button>
          </>
        ) : (
          <>
            <div className="flex gap-2 justify-center"
              onPaste={e => { const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (t.length === 6) { setOtp(t.split('')); otpRefs.current[5]?.focus(); } e.preventDefault(); }}>
              {otp.map((d, i) => (
                <input key={i} ref={el => { otpRefs.current[i] = el; }} type="text" inputMode="numeric"
                  maxLength={1} value={d} onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Backspace' && !d && i > 0) otpRefs.current[i - 1]?.focus(); if (e.key === 'Enter') verifyOtp(); }}
                  className="w-11 h-12 text-center text-lg font-semibold border border-border rounded-xl focus:outline-none focus:border-primary transition-colors" />
              ))}
            </div>
            {error && <p className="text-destructive text-xs mt-3 text-center">{error}</p>}
            <button onClick={verifyOtp} disabled={loading}
              className="mt-4 w-full py-3 rounded-xl text-sm font-medium text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-50 transition-opacity">
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <div className="mt-3 text-center space-y-1">
              {countdown > 0
                ? <p className="text-xs text-muted-foreground">Resend in {countdown}s</p>
                : <button onClick={() => { setOtp(['', '', '', '', '', '']); sendOtp(); }} className="text-xs text-primary hover:underline">Resend code</button>}
              <button onClick={() => { setStep('email'); setError(''); setOtp(['', '', '', '', '', '']); }}
                className="block mx-auto text-xs text-muted-foreground hover:text-foreground">← Change email</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
