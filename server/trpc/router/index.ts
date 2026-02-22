import { router } from '../trpc'
import { dashboardRouter } from './dashboard'
import { patientsRouter } from './patients'
import { appointmentsRouter } from './appointments'
import { encountersRouter } from './encounters'
import { claimsRouter } from './claims'
import { analyticsRouter } from './analytics'

export const appRouter = router({
  dashboard: dashboardRouter,
  patients: patientsRouter,
  appointments: appointmentsRouter,
  encounters: encountersRouter,
  claims: claimsRouter,
  analytics: analyticsRouter,
})

export type AppRouter = typeof appRouter
