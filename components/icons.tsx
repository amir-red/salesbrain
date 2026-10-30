/** Line icons, one set for the whole app (no emoji — brand basics). 1.75 stroke, 24-px grid, currentColor. */
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
export const Pencil = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4" /></svg>;
export const Clock =(p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;

export const Building = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 21V5l8-2v18M12 8l8 2.5V21M3 21h18M7.5 8h1M7.5 12h1M7.5 16h1M15.5 13h1M15.5 17h1" /></svg>;
export const Coins = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><ellipse cx="9" cy="7" rx="6" ry="2.5" /><path d="M3 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7M3 11v4c0 1.4 2.7 2.5 6 2.5 1 0 2-.1 2.8-.3" /><ellipse cx="16" cy="15.5" rx="5" ry="2" /><path d="M11 15.5v3c0 1.1 2.2 2 5 2s5-.9 5-2v-3" /></svg>;
export const Users = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.6a3.5 3.5 0 010 6.8M18 14.2a6.5 6.5 0 013.5 5.8" /></svg>;
export const MapPin = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;
export const Briefcase = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M3 13h18" /></svg>;
export const Ban = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></svg>;
export const Check = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const Sparkle = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" /></svg>;
export const Target = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>;
export const Info = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>;
export const ArrowLeft = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const ArrowRight = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const Sliders = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
export const Chat = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 5h16v11H9l-5 4z" /></svg>;

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
