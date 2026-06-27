'use client'

import { Suspense, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { trpc } from '@/lib/trpc/client'

function SignupForm() {
  const searchParams = useSearchParams()
  const noAccount = searchParams.get('reason') === 'no-account'

  const [name, setName] = useState('')
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const signup = trpc.auth.signup.useMutation({
    onSuccess: async () => {
      const result = await signIn('credentials', { email, password, redirect: false })
      if (result?.error) {
        setError('Account created but sign-in failed. Please go to login.')
      } else {
        router.push('/')
        router.refresh()
      }
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    signup.mutate({ name, email, password })
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel — branding */}
      <div className="hidden md:flex md:w-1/2 flex-col items-center justify-center bg-blue-600 px-12 text-white">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
            <Image src="/logo.png" alt="Yeam.ai EHR" width={72} height={72} priority className="h-16 w-16" />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">Yeam.ai EHR</h1>
            <p className="text-lg text-blue-100">Modern healthcare management,<br />powered by AI.</p>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-3 text-sm text-blue-100 text-left w-full max-w-xs">
            {[
              'AI-assisted clinical documentation',
              'Automated claim scrubbing & billing',
              'Real-time analytics dashboard',
            ].map(feature => (
              <div key={feature} className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-blue-300 shrink-0" />
                {feature}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full md:w-1/2 flex-col items-center justify-center bg-white px-8 py-12">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="flex flex-col items-center gap-2 md:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
              <Image src="/logo.png" alt="Yeam.ai EHR" width={32} height={32} className="h-8 w-8" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Yeam.ai EHR</h1>
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-gray-900">Create an account</h2>
            <p className="text-sm text-gray-500">Get started with Yeam.ai EHR</p>
          </div>

          {noAccount && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              No account found for that email. Create one below to continue.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium text-gray-700">
                Full name
              </label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Smith"
                required
                autoComplete="name"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-gray-700">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-gray-700">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                minLength={6}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm" className="text-sm font-medium text-gray-700">
                Confirm password
              </label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={signup.isPending}>
              {signup.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create account
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  )
}
