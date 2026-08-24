import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Appeal Letter Review — Yeam.ai',
  description: 'Review AI-drafted insurance appeal letters and draft a new one from your own denial documents.',
  // Shared by link with named reviewers — keep it out of search results.
  robots: { index: false, follow: false },
}

export default function AppealsLayout({ children }: { children: React.ReactNode }) {
  return children
}
