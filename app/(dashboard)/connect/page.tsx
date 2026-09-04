import { ConnectView } from '@/components/connect/ConnectView'

export default function ConnectPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Connect your data</h1>
        <p className="text-sm text-gray-500">
          Upload an export, or connect the system it comes from
        </p>
      </div>
      <ConnectView />
    </div>
  )
}
