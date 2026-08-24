import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const host =
    incomingHeaders.get('x-forwarded-host') ??
    incomingHeaders.get('host') ??
    'localhost:3000';
  const protocol =
    incomingHeaders.get('x-forwarded-proto') ??
    (host.startsWith('localhost') ? 'http' : 'https');
  const socialImage = new URL('/og.png', `${protocol}://${host}`).toString();

  return {
    title: {
      default: 'OrbitShield AI | Space Safety Intelligence',
      template: '%s | OrbitShield AI',
    },
    description:
      'Interactive orbital traffic visualization and explainable historical conjunction-risk replay.',
    openGraph: {
      type: 'website',
      title: 'OrbitShield AI',
      description: 'See orbital congestion. Understand conjunction risk.',
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: 'OrbitShield AI orbital conjunction intelligence',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'OrbitShield AI',
      description: 'See orbital congestion. Understand conjunction risk.',
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
