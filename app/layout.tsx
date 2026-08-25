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
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const socialImage = new URL('/og.png', `${protocol}://${host}`).toString();

  return {
    title: {
      default: 'OrbitShield AI: Orbital Traffic Intelligence',
      template: '%s | OrbitShield AI',
    },
    description:
      'CDM-driven ML risk prediction, explainable analyst alerts, and accelerated closest-approach visualization.',
    openGraph: {
      type: 'website',
      title: 'OrbitShield AI',
      description: 'Monitor satellites, score conjunction CDMs with a trained model, and investigate elevated risks on a live 3D globe.',
      images: [{
        url: socialImage,
        width: 1200,
        height: 630,
        alt: 'OrbitShield AI orbital traffic intelligence workspace',
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'OrbitShield AI',
      description: 'ML conjunction risk prediction and explainable analyst alerts on a live 3D globe.',
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
      <head>
        <link rel="preload" href="/earth-blue-marble.jpg" as="image" fetchPriority="high" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
