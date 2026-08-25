import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How Yeam Connects — Yeam',
  description:
    'How Yeam gets denial and claim data out of the systems a billing company already uses, and what is live versus in progress.',
  // Shared by link with named reviewers — keep it out of search results.
  robots: { index: false, follow: false },
}

export default function HowWeConnectLayout({ children }: { children: React.ReactNode }) {
  return children
}
