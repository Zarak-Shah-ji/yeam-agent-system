'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { format, differenceInYears } from 'date-fns'
import { ArrowLeft, Save, PenLine, Sparkles, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog'
import { SOAPAssistDialog } from './SOAPAssistDialog'

const STATUS_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'destructive'> = {
  DRAFT: 'warning', SIGNED: 'success', AMENDED: 'default', VOIDED: 'destructive',
}

interface SOAPState {
  subjective: string
  objective: string
  assessment: string
  plan: string
}

export function EncounterEditor({ id }: { id: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data: enc, isLoading } = trpc.encounters.getById.useQuery({ id })

  const [soap, setSOAP] = useState<SOAPState>({ subjective: '', objective: '', assessment: '', plan: '' })
  const [isDirty, setIsDirty] = useState(false)
  const [showSignDialog, setShowSignDialog] = useState(false)
  const [showAssist, setShowAssist] = useState(false)

  // Seed state from server data once loaded
  useEffect(() => {
    if (enc) {
      setSOAP({
        subjective: enc.subjective ?? '',
        objective: enc.objective ?? '',
        assessment: enc.assessment ?? '',
        plan: enc.plan ?? '',
      })
    }
  }, [enc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = trpc.encounters.updateSOAP.useMutation({
    onSuccess: () => {
      setIsDirty(false)
      utils.encounters.getById.invalidate({ id })
    },
  })

  const signMutation = trpc.encounters.sign.useMutation({
    onSuccess: () => {
      setShowSignDialog(false)
      utils.encounters.getById.invalidate({ id })
    },
  })

  function handleSOAPChange(field: keyof SOAPState, value: string) {
    setSOAP(prev => ({ ...prev, [field]: value }))
    setIsDirty(true)
  }

  function handleAssistFill(fields: Partial<SOAPState>) {
    setSOAP(prev => ({
      subjective: fields.subjective ?? prev.subjective,
      objective: fields.objective ?? prev.objective,
      assessment: fields.assessment ?? prev.assessment,
      plan: fields.plan ?? prev.plan,
    }))
    setIsDirty(true)
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (!enc) return <div className="text-gray-500 p-8 text-center">Encounter not found.</div>

  const isDraft = enc.status === 'DRAFT'
  const age = enc.patient ? differenceInYears(new Date(), new Date(enc.patient.dateOfBirth)) : null
  const chiefComplaint = enc.appointment?.chiefComplaint ?? undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">
                {enc.patient.firstName} {enc.patient.lastName}
              </h1>
              <Badge variant={STATUS_VARIANTS[enc.status] ?? 'secondary'}>{enc.status}</Badge>
            </div>
            <p className="text-sm text-gray-500">
              {format(new Date(enc.encounterDate), 'MMMM d, yyyy')} ·{' '}
              {enc.provider.firstName} {enc.provider.lastName}, {enc.provider.credential}
              {age !== null && ` · Patient age ${age}y`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDraft && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAssist(true)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1 text-blue-500" />
                AI Assist
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!isDirty || updateMutation.isPending}
                onClick={() => updateMutation.mutate({ id, ...soap })}
              >
                {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save Draft
              </Button>
              <Button
                size="sm"
                onClick={() => setShowSignDialog(true)}
              >
                <PenLine className="h-3.5 w-3.5 mr-1" />
                Sign
              </Button>
            </>
          )}
          {enc.status === 'SIGNED' && enc.signedAt && (
            <div className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Signed {format(new Date(enc.signedAt), 'MMM d, yyyy h:mm a')}
            </div>
          )}
        </div>
      </div>

      {/* Unsaved indicator */}
      {isDirty && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Unsaved changes
        </div>
      )}

      {/* Main layout */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* SOAP editor — 2/3 width */}
        <div className="lg:col-span-2 space-y-4">
          {(['subjective', 'objective', 'assessment', 'plan'] as const).map(field => (
            <Card key={field}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm capitalize text-gray-700">{field}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Textarea
                  value={soap[field]}
                  onChange={e => handleSOAPChange(field, e.target.value)}
                  disabled={!isDraft}
                  className="min-h-[100px]"
                  placeholder={
                    field === 'subjective' ? 'Chief complaint, history, symptoms…'
                    : field === 'objective' ? 'Vitals, physical exam, lab results…'
                    : field === 'assessment' ? 'Diagnoses, clinical impression…'
                    : 'Treatment plan, medications, follow-up…'
                  }
                />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Sidebar — 1/3 width */}
        <div className="space-y-4">
          {/* Diagnoses */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-700">Diagnoses (ICD-10)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {enc.diagnoses.length === 0 ? (
                <p className="text-xs text-gray-400">No diagnoses</p>
              ) : (
                <ul className="space-y-1.5">
                  {enc.diagnoses.map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      {d.isPrimary && <span className="text-xs bg-blue-100 text-blue-700 px-1 py-0.5 rounded shrink-0">Primary</span>}
                      <div>
                        <span className="text-xs font-mono bg-gray-100 px-1 rounded">{d.icdCode}</span>
                        <span className="text-xs text-gray-600 ml-1">{d.description}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Procedures */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-700">Procedures (CPT)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {enc.procedures.length === 0 ? (
                <p className="text-xs text-gray-400">No procedures</p>
              ) : (
                <ul className="space-y-1.5">
                  {enc.procedures.map(p => (
                    <li key={p.id} className="flex items-start justify-between">
                      <div>
                        <span className="text-xs font-mono bg-gray-100 px-1 rounded">{p.cptCode}</span>
                        <span className="text-xs text-gray-600 ml-1">{p.description}</span>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0 ml-2">
                        ${Number(p.fee).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Insurance */}
          {enc.patient.coverages?.[0] && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-700">Insurance</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-gray-600 space-y-1">
                <p className="font-medium">{enc.patient.coverages[0].payer.name}</p>
                <p>Member: {enc.patient.coverages[0].memberId}</p>
                <p>Copay: ${enc.patient.coverages[0].copay?.toString() ?? '0'}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Sign confirmation dialog */}
      <Dialog open={showSignDialog} onOpenChange={setShowSignDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign Encounter</DialogTitle>
            <DialogDescription>
              Signing this encounter locks the note. You will not be able to edit it after signing. Proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSignDialog(false)}>Cancel</Button>
            <Button
              onClick={() => signMutation.mutate({ id })}
              disabled={signMutation.isPending}
            >
              {signMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Sign Encounter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Assist dialog */}
      <SOAPAssistDialog
        open={showAssist}
        onClose={() => setShowAssist(false)}
        onFill={handleAssistFill}
        chiefComplaint={chiefComplaint}
        patientAge={age ?? undefined}
      />
    </div>
  )
}
