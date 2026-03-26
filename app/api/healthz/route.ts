import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  const hasSecret = !!process.env.AUTH_SECRET
  const hasDb = !!process.env.DATABASE_URL
  const secretLen = process.env.AUTH_SECRET?.length ?? 0
  try {
    await prisma.$queryRaw`SELECT 1`
    const count = await prisma.user.count()
    return NextResponse.json({ db: 'ok', userCount: count, hasSecret, hasDb, secretLen })
  } catch (e: unknown) {
    return NextResponse.json({ db: 'error', message: String(e), hasSecret, hasDb, secretLen }, { status: 500 })
  }
}
