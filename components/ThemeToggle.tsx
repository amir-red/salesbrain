'use client';

import { useEffect, useState } from 'react';

const EVENT = 'salesbrain-theme';

// Light is the default (brand: data tools start in the light product style).
// Several toggles can be mounted at once (sidebar + a page header); they stay
// in sync through the EVENT.
export default function ThemeToggle({ label }: { label?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const read = () => setDark(document.documentElement.classList.contains('dark'));
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.classList.toggle('light', !next);
    try { localStorage.setItem('salesbrain-theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
    window.dispatchEvent(new Event(EVENT));
  };

  const text = dark ? 'Light mode' : 'Dark mode';
  return (
    <button
      onClick={toggle}
      className="p-1.5 rounded-md transition-colors hover:opacity-80 flex items-center gap-3"
      style={{ color: 'var(--text-muted)' }}
      title={`Switch to ${text.toLowerCase()}`}
      aria-label={`Switch to ${text.toLowerCase()}`}
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      {label && <span className="text-sm">{text}</span>}
    </button>
  );
}
