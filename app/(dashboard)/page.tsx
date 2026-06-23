import Link from 'next/link'
import {
  Users,
  Calendar,
  FileText,
  CreditCard,
  Activity,
  BarChart3,
} from 'lucide-react'
import { HeroSection } from '@/components/dashboard/HeroSection'
import { MetricsCards } from '@/components/dashboard/MetricsCards'
import { AppointmentList } from '@/components/dashboard/AppointmentList'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const featureNav = [
  {
    href: '/patients',
    label: 'Patients',
    icon: Users,
    description: 'Browse records, search by name or MRN, view encounter history.',
  },
  {
    href: '/appointments',
    label: 'Appointments',
    icon: Calendar,
    description: "View today's schedule, check patients in, manage cancellations.",
  },
  {
    href: '/encounters',
    label: 'Encounters',
    icon: FileText,
    description: 'Edit SOAP notes, run AI-assisted clinical documentation.',
  },
  {
    href: '/claims',
    label: 'Claims',
    icon: CreditCard,
    description: 'Track submission status, inspect ICD-10 / CPT codes.',
  },
  {
    href: '/billing',
    label: 'Billing',
    icon: Activity,
    description: 'Review denied claims and draft AI-generated appeal letters.',
  },
  {
    href: '/analytics',
    label: 'Analytics',
    icon: BarChart3,
    description: 'Revenue trends, denial rates, and natural-language data queries.',
  },
]

export default function DashboardPage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <HeroSection />

      {/* Feature nav grid */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
          Or browse directly
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {featureNav.map(({ href, label, icon: Icon, description }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-blue-300 hover:shadow-md transition-all group"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-gray-900">{label}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Today's overview */}
      <section className="space-y-6 pb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Today&apos;s overview
        </h2>
        <MetricsCards />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Today&apos;s Appointments</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <AppointmentList />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
