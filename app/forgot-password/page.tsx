'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Always show success — the API deliberately obscures whether the email existed.
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-1">SalesBrain</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Reset your password</p>
        </div>

        {submitted ? (
          <div className="space-y-4">
            <div
              className="px-3 py-3 rounded-lg text-sm"
              style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.2)' }}
            >
              If an account exists for <strong>{email}</strong>, a reset link has been sent.
              Check your inbox (and spam folder). The link expires in 1 hour.
            </div>
            <Link
              href="/login"
              className="block text-center text-sm"
              style={{ color: 'var(--accent)' }}
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Enter the email associated with your account and we&apos;ll send you a link to reset your password.
            </p>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none focus:ring-2"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  '--tw-ring-color': 'var(--accent)',
                } as React.CSSProperties}
                placeholder="you@company.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity"
              style={{ background: 'var(--accent)', color: '#fff', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>

            <div className="flex items-center justify-between text-sm">
              <Link href="/login" style={{ color: 'var(--text-muted)' }} className="hover:underline">
                ← Back to sign in
              </Link>
              <Link href="/signup" style={{ color: 'var(--accent)' }} className="hover:underline">
                Sign up
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
