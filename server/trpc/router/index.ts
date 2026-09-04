import { router } from '../trpc'
import { authRouter } from './auth'
import { dashboardRouter } from './dashboard'
import { patientsRouter } from './patients'
import { appointmentsRouter } from './appointments'
import { encountersRouter } from './encounters'
import { claimsRouter } from './claims'
import { analyticsRouter } from './analytics'
import { worklistRouter } from './worklist'
import { insightsRouter } from './insights'
import { importsRouter } from './imports'
import { connectionsRouter } from './connections'

export const appRouter = router({
  auth: authRouter,
  dashboard: dashboardRouter,
  patients: patientsRouter,
  appointments: appointmentsRouter,
  encounters: encountersRouter,
  claims: claimsRouter,
  analytics: analyticsRouter,
  worklist: worklistRouter,
  insights: insightsRouter,
  imports: importsRouter,
  connections: connectionsRouter,
})

export type AppRouter = typeof appRouter
