import type { Metadata } from 'next'
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { TRPCProvider } from '@/lib/trpc/provider'
import { themeBootstrapScript } from '@/lib/theme'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

/**
 * The marketing site's typeface, loaded here so app.yeam.ai and yeam.ai read as
 * one brand. Currently worn only by /login and /signup (via .font-brand) — the
 * dashboard still runs on Geist, so this costs those pages nothing but the
 * variable declaration; next/font only fetches the faces a page actually paints.
 *
 * Weights match yeam_website/app/layout.tsx. Keep them in step with that file.
 */
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-brand',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

export const metadata: Metadata = {
  // "Yeam", not "Yeam.ai" — the .ai is a domain, not the name. And not "EHR":
  // the EHR generation was removed in the consolidation; this is a denial and
  // appeal tool that reads a claims export.
  title: 'Yeam',
  description: 'Denial management and appeals for medical billing teams',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${plusJakartaSans.variable} antialiased`}
      >
        <TRPCProvider>{children}</TRPCProvider>
        {/*
          Where a completed appeal letter is rendered for printing. Hidden on
          screen, and the only thing @media print keeps. Lives at the root so the
          print rule can address it as a direct child of body — a container
          nested inside the dashboard chrome would be hidden along with it.

          Filled imperatively by components/worklist/SendPanel.tsx immediately
          before window.print(). It holds the patient's name and member ID for
          the duration of the print dialog and is never serialized anywhere.
        */}
        <div id="yeam-print-letter" aria-hidden="true" />
      </body>
    </html>
  )
}
