import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma so no DB connection is needed
vi.mock('@/lib/db', () => ({
  prisma: {
    medicaidEncounter: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    agentLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

// Force GEMINI off so we test the stub/DB path
vi.mock('@/lib/agents/gemini-client', () => ({
  GEMINI_AVAILABLE: false,
  getModel: vi.fn(),
  getFlashModel: vi.fn(),
  getProModel: vi.fn(),
}))

describe('Task 2 – Analytics agent uses real DB data', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { prisma } = await import('@/lib/db')
    // Return 42 encounters, 7 denied, $12345.67 collected
    ;(prisma.medicaidEncounter.count as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(42)   // total
      .mockResolvedValueOnce(7)    // denied
    ;(prisma.medicaidEncounter.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { paidAmount: { toNumber: () => 12345.67 } },
    })
  })

  it('complete event data.encounters should reflect DB count (42), not hardcoded 6000', async () => {
    const { AnalyticsAgent } = await import('@/lib/agents/analytics-agent')
    const agent = new AnalyticsAgent()
    const task = {
      id: 'test-id',
      intent: 'query-metrics',
      context: {},
      userId: 'user1',
      sessionId: 'sess1',
    }

    const events = []
    for await (const event of agent.execute(task)) {
      events.push(event)
    }

    const completeEvent = events.find(e => e.status === 'complete')
    expect(completeEvent).toBeDefined()
    // The fixed agent should return DB-driven data, not the hardcoded 6000
    const data = completeEvent?.data as Record<string, unknown> | undefined
    expect(data?.encounters).toBe(42)
  })
})
