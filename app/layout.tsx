import type { Metadata } from 'next';
// @ts-expect-error -- CSS import handled by Next.js bundler
import './globals.css';

export const metadata: Metadata = {
  title: 'SalesBrain — Agentic B2B Sales CRM',
  description: 'AI-powered sales pipeline management with Claude',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
