'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { AuthShell } from '@/components/auth/AuthShell'
import { AuthDivider, AuthError, AuthField } from '@/components/auth/AuthField'
import { SIGNUP_CLOSED_MESSAGE } from '@/lib/signup-access'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // Surface the reason an OAuth sign-in was refused.
  //
  // pages.error routes auth failures back here rather than to NextAuth's own
  // error route, which renders a 500. Nothing read the code it arrives with, so
  // a refused "Continue with Google" completed a full round trip to Google and
  // landed on a login page identical to the one it left — no message, nothing
  // to act on, indistinguishable from a broken button.
  //
  // Read from window rather than useSearchParams: this page is a client
  // component with no Suspense boundary, and useSearchParams would opt the
  // whole route out of static rendering to deliver one query param.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error')
    if (!code) return
    setError(
      code === 'AccessDenied'
        ? SIGNUP_CLOSED_MESSAGE
        : 'Could not sign you in. Please try again.',
    )
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Invalid email or password.')
      } else {
        router.push('/')
        router.refresh()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Sign in to your workspace"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-semibold text-[#5BE3F5] hover:text-[#9DF0FA]">
            Sign up
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GoogleButton />

        <AuthDivider label="or" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />

          <AuthField
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />

          {error && <AuthError>{error}</AuthError>}

          <Button
            type="submit"
            disabled={loading}
            className="h-10 w-full rounded-lg bg-[#05DBF0] font-bold text-[#032431] shadow-lg shadow-[#05DBF0]/25 hover:bg-[#3FE6F7]"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </div>
    </AuthShell>
  )
}
