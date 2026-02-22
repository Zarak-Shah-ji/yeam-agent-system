'use client'

import { useState, useRef } from 'react'
import { Loader2, Bot, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog'

type SOAPFields = { subjective: string; objective: string; assessment: string; plan: string }

interface Props {
  open: boolean
  onClose: () => void
  onFill: (fields: Partial<SOAPFields>) => void
  chiefComplaint?: string
  patientAge?: number
}

export function SOAPAssistDialog({ open, onClose, onFill, chiefComplaint, patientAge }: Props) {
  const [description, setDescription] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamedMessage, setStreamedMessage] = useState('')
  const [error, setError] = useState('')
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  async function handleGenerate() {
    if (!description.trim() && !chiefComplaint) return
    setIsStreaming(true)
    setStreamedMessage('')
    setError('')

    try {
      const res = await fetch('/api/agents/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'soap-assist',
          context: {
            chiefComplaint: chiefComplaint ?? description,
            visitDescription: description,
            patientAge,
          },
        }),
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''
      let lastCompleteData: Record<string, unknown> | null = null

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
            if (event.status === 'complete' && event.data) {
              lastCompleteData = event.data as Record<string, unknown>
            }
            setStreamedMessage(event.message ?? '')
          } catch { /* ignore */ }
        }
      }

      // Fill editor with AI suggestions
      if (lastCompleteData) {
        onFill({
          subjective: lastCompleteData.subjective as string | undefined ?? '',
          objective: lastCompleteData.objective as string | undefined ?? '',
          assessment: lastCompleteData.assessment as string | undefined ?? '',
          plan: lastCompleteData.plan as string | undefined ?? '',
        })
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate note')
    } finally {
      setIsStreaming(false)
      readerRef.current = null
    }
  }

  function handleClose() {
    if (isStreaming) {
      readerRef.current?.cancel()
    }
    setDescription('')
    setStreamedMessage('')
    setError('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-500" />
            AI SOAP Note Assist
          </DialogTitle>
          <DialogDescription>
            Describe the visit and Claude will generate SOAP note suggestions for you to review and edit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-2">
          {chiefComplaint && (
            <div className="text-sm text-gray-600 bg-blue-50 rounded-md px-3 py-2">
              Chief complaint: <span className="font-medium">{chiefComplaint}</span>
            </div>
          )}
          <Textarea
            placeholder="Describe the visit: symptoms, findings, decisions made…"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="min-h-[100px]"
            disabled={isStreaming}
          />
          {streamedMessage && (
            <div className="flex items-start gap-2 text-sm text-gray-600 bg-gray-50 rounded-md px-3 py-2">
              <Bot className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
              <span>{streamedMessage}</span>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isStreaming}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={isStreaming || (!description.trim() && !chiefComplaint)}>
            {isStreaming ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-1" />Generating…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-1" />Generate SOAP</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
