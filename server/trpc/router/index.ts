import { router } from '../trpc'
import { authRouter } from './auth'
import { activityRouter } from './activity'
import { agentRouter } from './agent'
import { worklistRouter } from './worklist'
import { insightsRouter } from './insights'
import { claimsRouter } from './claims'
import { importsRouter } from './imports'
import { connectionsRouter } from './connections'
import { settingsRouter } from './settings'

/**
 * Every router here is org-scoped (see orgProcedure) except `auth`, which is
 * pre-login by necessity. Adding one that is not is a tenant-isolation bug.
 */
export const appRouter = router({
  auth: authRouter,
  activity: activityRouter,
  agent: agentRouter,
  worklist: worklistRouter,
  insights: insightsRouter,
  claims: claimsRouter,
  imports: importsRouter,
  connections: connectionsRouter,
  settings: settingsRouter,
})

export type AppRouter = typeof appRouter
