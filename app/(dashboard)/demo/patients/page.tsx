import { PatientTable } from '@/components/patients/PatientTable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function PatientsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
        <p className="text-sm text-gray-500 mt-0.5">Search and manage patient records</p>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Patients</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <PatientTable />
        </CardContent>
      </Card>
    </div>
  )
}
