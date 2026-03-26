import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok' })
  } catch (e: unknown) {
    return NextResponse.json({ status: 'error', message: String(e) }, { status: 500 })
  }
}
