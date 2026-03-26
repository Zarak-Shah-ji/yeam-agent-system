import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    const count = await prisma.user.count()
    return NextResponse.json({ db: 'ok', userCount: count })
  } catch (e: unknown) {
    return NextResponse.json({ db: 'error', message: String(e) }, { status: 500 })
  }
}
