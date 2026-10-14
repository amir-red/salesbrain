/** Line icons for /sales-leads (one set, no emoji — brand basics). 1.75 stroke, currentColor. */
import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
});

export const Star = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />
  </svg>
);
export const Chevron = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>;
export const Search = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
export const LinkedIn = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M6.5 9.5v9M6.5 6.2v.1M10.5 18.5v-5.3c0-2 1.2-3.2 3-3.2s2.8 1.2 2.8 3.2v5.3" stroke="currentColor" fill="none" />
  </svg>
);
export const Phone = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>;
export const Mail = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>;
export const Send = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" /></svg>;
export const Reply = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 10l-5 4 5 4M4 14h9a6 6 0 006-6V6" /></svg>;
export const Calendar = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;
export const Handshake = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 11l4-4h4l3 3M21 11l-4-4h-3M7 11l5 5 2-2M12 16l2 2 2-2 2-2M3 11v4l4 4M21 11v4l-4 4" /></svg>;
export const Note = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 3h9l5 5v13H6z M14 3v5h5M9 13h7M9 17h5" /></svg>;
export const Flag = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 21V4h11l-1.5 4L16 12H5" /></svg>;
export const User = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>;
export const Download = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>;
export const Dot = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
export const External = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9M19 14v6H4V5h6" /></svg>;
export const Clock = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;

export function EventIcon({ kind, ...p }: SVGProps<SVGSVGElement> & { kind: string }) {
  switch (kind) {
    case 'met': return <Handshake {...p} />;
    case 'sent': return <Send {...p} />;
    case 'reply': return <Reply {...p} />;
    case 'call': return <Phone {...p} />;
    case 'meeting': return <Calendar {...p} />;
    case 'note': return <Note {...p} />;
    case 'status': return <Flag {...p} />;
    case 'priority': return <Star {...p} />;
    case 'assign': return <User {...p} />;
    case 'import': return <Download {...p} />;
    default: return <Dot {...p} />;
  }
}
