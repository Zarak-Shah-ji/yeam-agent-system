'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function PasscodeGate({ configured }: { configured: boolean }) {
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!passcode.trim() || pending) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/appeals/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcode.trim() }),
      })
      if (res.ok) {
        window.location.reload()
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'That access code is not correct.')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(165deg,#143A66_0%,#0E2748_58%,#091B34_100%)] px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-white shadow-xl shadow-black/20 ring-1 ring-white/10">
            <Image src="/logo.png" alt="Yeam" width={52} height={52} className="h-13 w-13 object-contain" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Yeam
          </h1>
          <p className="mt-2 text-sm text-slate-300">Appeal Letter Review</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/30">
          <label htmlFor="passcode" className="block text-sm font-medium text-gray-900">
            Access code
          </label>
          <p className="mt-1 text-xs text-gray-500">
            {configured
              ? 'Enter the code that came with your invitation link.'
              : 'This portal has not been configured yet. Contact the Yeam team.'}
          </p>
          <Input
            id="passcode"
            type="password"
            autoFocus
            autoComplete="off"
            disabled={!configured || pending}
            value={passcode}
            onChange={e => setPasscode(e.target.value)}
            placeholder="Access code"
            className="mt-3"
          />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={!configured || pending || !passcode.trim()} className="mt-4 w-full">
            {pending ? 'Checking…' : 'View appeals'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Demonstration environment. All patient data shown is synthetic.
        </p>
      </div>
    </main>
  )
}
