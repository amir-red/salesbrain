import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The app's buttons, as the main pages draw them: rounded-lg, primary = accent fill, secondary = a bordered outline,
 * danger = red text, success = green fill (a final "save"). Pass `href` for a link that looks like a button.
 */
type Variant = 'primary' | 'secondary' | 'danger' | 'success';

const STYLE: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--accent-fg)' },
  secondary: { border: '1px solid var(--border)', color: 'var(--text)' },
  danger: { border: '1px solid var(--border)', color: 'var(--red)' },
  success: { background: 'var(--green)', color: 'var(--accent-fg)' },
};

export default function Button({ variant = 'secondary', size = 'md', href, className = '', children, ...rest }: {
  variant?: Variant; size?: 'sm' | 'md'; href?: string; children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = `${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded-lg font-medium disabled:opacity-40 whitespace-nowrap inline-flex items-center gap-1.5 ${className}`;
  if (href) return <Link href={href} className={cls} style={STYLE[variant]}>{children}</Link>;
  return <button type="button" className={cls} style={STYLE[variant]} {...rest}>{children}</button>;
}
