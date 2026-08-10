'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { AuthBrandPanel, AuthMobileHeader } from '@/components/auth/AuthBrandPanel'
import { trpc } from '@/lib/trpc/client'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
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
      <AuthBrandPanel />

      {/* Right panel — form */}
      <div className="flex w-full md:w-1/2 flex-col items-center justify-center bg-white px-8 py-12">
        <div className="w-full max-w-sm space-y-6">
          <AuthMobileHeader />

          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-gray-900">Create an account</h2>
            <p className="text-sm text-gray-500">Get started with Yeam.ai EHR</p>
          </div>

          {/* OAuth */}
          <GoogleButton label="Sign up with Google" />

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-400">or sign up with email</span>
            </div>
          </div>

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

