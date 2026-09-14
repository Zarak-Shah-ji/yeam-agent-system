import { SettingsView } from '@/components/settings/SettingsView'

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">
          The details every appeal needs, filled in once
        </p>
      </div>
      <SettingsView />
    </div>
  )
}
