'use client'

import { useState, useRef } from 'react'
import { format } from 'date-fns'
import { Loader2, Sparkles, ChevronDown, ChevronUp, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface DeniedClaim {
  id: string
  claimNumber: string
  serviceDate: string | Date
  totalBilled: number
  denialReason: string | null
  patient: { firstName: string; lastName: string; mrn: string }
  payer: { name: string }
}

interface Props {
  claim: DeniedClaim
  onStatusChange: () => void
}

export function DeniedClaimCard({ claim, onStatusChange }: Props) {
  const [showAppeal, setShowAppeal] = useState(false)
  const [appealText, setAppealText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  const utils = trpc.useUtils()
  const updateMutation = trpc.claims.updateStatus.useMutation({
    onSuccess: () => {
      utils.claims.list.invalidate()
      onStatusChange()
    },
  })

  async function handleDraftAppeal() {
    setIsStreaming(true)
    setAppealText('')
    setShowAppeal(true)

    try {
      const res = await fetch('/api/agents/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'draft-appeal',
          context: {
            claimNumber: claim.claimNumber,
            denialReason: claim.denialReason,
            patientName: `${claim.patient.firstName} ${claim.patient.lastName}`,
            payer: claim.payer.name,
            serviceDate: format(new Date(claim.serviceDate), 'MM/dd/yyyy'),
            amount: claim.totalBilled,
          },
        }),
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''
      let lastData: Record<string, unknown> | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const event = JSON.parse(raw)
            if (event.status === 'complete' && event.data) lastData = event.data as Record<string, unknown>
            if (event.message) setAppealText(event.message)
          } catch { /* ignore */ }
        }
      }
      if (lastData?.appealLetter) setAppealText(lastData.appealLetter as string)
    } catch (err) {
      setAppealText(err instanceof Error ? err.message : 'Failed to generate appeal')
    } finally {
      setIsStreaming(false)
      readerRef.current = null
    }
  }

  return (
    <Card className="border-red-100">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-gray-500">{claim.claimNumber}</span>
              <Badge variant="destructive" className="text-xs">DENIED</Badge>
            </div>
            <p className="font-medium text-sm mt-0.5">
              {claim.patient.firstName} {claim.patient.lastName}
              <span className="text-gray-400 font-normal ml-1">· {claim.patient.mrn}</span>
            </p>
            <p className="text-xs text-gray-500">
              {claim.payer.name} · {format(new Date(claim.serviceDate), 'MM/dd/yyyy')} · ${Number(claim.totalBilled).toFixed(2)}
            </p>
            {claim.denialReason && (
              <p className="text-xs text-red-600 mt-1">Reason: {claim.denialReason}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDraftAppeal}
              disabled={isStreaming || updateMutation.isPending}
            >
              {isStreaming
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <Sparkles className="h-3.5 w-3.5 mr-1 text-blue-500" />}
              AI Appeal
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-gray-400 hover:text-gray-600"
              onClick={() => updateMutation.mutate({ id: claim.id, status: 'VOIDED', notes: 'Written off' })}
              disabled={updateMutation.isPending}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Write Off
            </Button>
          </div>
        </div>

        {showAppeal && (
          <div className="space-y-2">
            <button
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              onClick={() => setShowAppeal(v => !v)}
            >
              {showAppeal ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Appeal draft
            </button>
            <textarea
              value={appealText}
              onChange={e => setAppealText(e.target.value)}
              className="w-full text-xs border rounded-md p-2 min-h-[140px] font-mono leading-relaxed bg-gray-50"
              placeholder={isStreaming ? 'Generating…' : 'Appeal letter will appear here'}
              readOnly={isStreaming}
            />
            {!isStreaming && appealText && (
              <Button
                size="sm"
                onClick={() => updateMutation.mutate({ id: claim.id, status: 'APPEALED', notes: 'Appeal submitted' })}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Submit Appeal
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
