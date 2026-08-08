import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { onest, mollwish } from './fonts';
import { Toaster } from '@/components/ui/toaster';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'SparkSocial',
  description: 'Agent-first social media operating system.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Without these, `auth.protect()` sends users to Clerk's *hosted* pages and
    // the custom screens in `(auth)/` are never reached.
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/meet-spark"
    >
      <html lang="en" className={`${onest.variable} ${mollwish.variable}`}>
        <body>
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
