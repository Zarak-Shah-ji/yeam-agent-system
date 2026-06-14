import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const { pathname } = req.nextUrl

  // Allow public auth pages and auth/debug API routes through
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/api/healthz'
  ) {
    return NextResponse.next()
  }

  // Return 401 (not a redirect) for unauthenticated API calls
  if (pathname.startsWith('/api/') && !isLoggedIn) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Redirect unauthenticated users to login
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', req.nextUrl)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  // Run on all routes except Next internals and static files (anything with a
  // file extension, e.g. /logo.png), so public assets are served directly.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
}
