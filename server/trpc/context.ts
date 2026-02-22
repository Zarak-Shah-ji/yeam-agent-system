import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function createContext() {
  const session = await auth()
  return {
    session,
    prisma,
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
