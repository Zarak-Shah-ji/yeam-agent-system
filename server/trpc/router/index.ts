import { router } from '../trpc'
import { authRouter } from './auth'
import { activityRouter } from './activity'
import { worklistRouter } from './worklist'
import { insightsRouter } from './insights'
import { importsRouter } from './imports'
import { connectionsRouter } from './connections'

/**
 * Every router here is org-scoped (see orgProcedure) except `auth`, which is
 * pre-login by necessity. Adding one that is not is a tenant-isolation bug.
 */
export const appRouter = router({
  auth: authRouter,
  activity: activityRouter,
  worklist: worklistRouter,
  insights: insightsRouter,
  imports: importsRouter,
  connections: connectionsRouter,
})

export type AppRouter = typeof appRouter
