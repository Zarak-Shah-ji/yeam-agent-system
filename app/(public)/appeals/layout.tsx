import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Appeal Letter Review — Yeam',
  description: 'Review drafted insurance appeal letters and create a new one from your own denial documents.',
  // Shared by link with named reviewers — keep it out of search results.
  robots: { index: false, follow: false },
}

export default function AppealsLayout({ children }: { children: React.ReactNode }) {
  // `theme-static` pins the light palette: this page is dark by design and
  // must not invert when a signed-in user has the dashboard in dark mode.
  return <div className="theme-static">{children}</div>
}
