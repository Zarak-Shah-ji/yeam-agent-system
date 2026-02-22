import { EncounterList } from '@/components/encounters/EncounterList'

export default function EncountersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Encounters</h1>
        <p className="text-sm text-gray-500 mt-0.5">Clinical encounter documentation</p>
      </div>
      <EncounterList />
    </div>
  )
}
