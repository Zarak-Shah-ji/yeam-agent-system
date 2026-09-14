'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { AuthShell } from '@/components/auth/AuthShell'
import { AuthDivider, AuthError, AuthField } from '@/components/auth/AuthField'
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
    <AuthShell
      title="Create an account"
      subtitle="Create your workspace"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-[#5BE3F5] hover:text-[#9DF0FA]">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <GoogleButton label="Sign up with Google" />

        <AuthDivider label="or" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthField
            id="name"
            label="Full name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jane Smith"
            required
            autoComplete="name"
          />

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
            autoComplete="new-password"
            minLength={6}
          />

          <AuthField
            id="confirm"
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="new-password"
          />

          {error && <AuthError>{error}</AuthError>}

          <Button
            type="submit"
            disabled={signup.isPending}
            className="h-10 w-full rounded-lg bg-[#05DBF0] font-bold text-[#032431] shadow-lg shadow-[#05DBF0]/25 hover:bg-[#3FE6F7]"
          >
            {signup.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create account
          </Button>
        </form>
      </div>
    </AuthShell>
  )
}
