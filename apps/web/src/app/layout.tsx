import type { Metadata } from 'next';
import { onest, mollwish } from './fonts';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'SparkSocial',
  description: 'Agent-first social media operating system.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${onest.variable} ${mollwish.variable}`}>
      <body>{children}</body>
    </html>
  );
}
