import { EncounterEditor } from '@/components/encounters/EncounterEditor'

export default async function EncounterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EncounterEditor id={id} />
}
