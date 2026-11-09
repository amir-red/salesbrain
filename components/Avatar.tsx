'use client';

import { useEffect, useState } from 'react';
import { initialsOf } from '@/lib/lead-brief';

/**
 * A person's picture (the LinkedIn profile picture a profile fetch stored on people.facets) with initials behind it:
 * the CDN link expires after a while, so a picture that fails to load falls back to the initials without a broken image.
 */
export default function Avatar({ name, src, size = 40, className = '' }: { name: string | null | undefined; src?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const show = !!src && !broken;
  const font = Math.max(11, Math.round(size * 0.36));
  return (
    <span className={`inline-flex items-center justify-center rounded-full overflow-hidden flex-shrink-0 font-semibold select-none ${className}`}
      style={{ width: size, height: size, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: font, lineHeight: 1 }}
      aria-label={name || 'person'} title={name || undefined}>
      {show
        ? <img src={src as string} alt="" width={size} height={size} className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : initialsOf(name)}
    </span>
  );
}
