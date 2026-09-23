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
import { practicesRouter } from './practices'
import { subscriptionRouter } from './subscription'
import { usageRouter } from './usage'

/**
 * Every router here is org-scoped (see orgProcedure) except `auth`, which is
 * pre-login by necessity. Adding one that is not is a tenant-isolation bug.
 *
 * Some are additionally practice-scoped (practiceProcedure), which is a VIEW
 * and not a boundary: it narrows to one clinic inside the workspace, every
 * query still carries its orgId, and a forgotten practice filter is a UX bug
 * where a forgotten org filter is a leak. See lib/practices/scope.ts.
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
  practices: practicesRouter,
  subscription: subscriptionRouter,
  usage: usageRouter,
})

export type AppRouter = typeof appRouter
