import { describe, it, expect } from 'vitest'

describe('Task 3 – Delete mutations exist on tRPC routers', () => {
  it('encountersRouter should expose a "delete" procedure', async () => {
    const { encountersRouter } = await import('@/server/trpc/router/encounters')
    const procedures = (encountersRouter as unknown as { _def: { record: Record<string, unknown> } })._def.record
    expect(procedures, 'encountersRouter is missing a "delete" procedure').toHaveProperty('delete')
  })

  it('appointmentsRouter should expose a "delete" procedure', async () => {
    const { appointmentsRouter } = await import('@/server/trpc/router/appointments')
    const procedures = (appointmentsRouter as unknown as { _def: { record: Record<string, unknown> } })._def.record
    expect(procedures, 'appointmentsRouter is missing a "delete" procedure').toHaveProperty('delete')
  })
})
