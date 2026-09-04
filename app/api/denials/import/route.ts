/**
 * Legacy denials import.
 *
 * Superseded by /api/imports/preview + /api/imports/commit, which show the
 * customer the column mapping before anything is saved. Kept as a thin forward
 * so a client that has not moved over still works; delete once nothing posts
 * here.
 */
import { POST as commit } from '@/app/api/imports/commit/route'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const form = await request.formData()
  form.set('profile', 'denials')
  return commit(
    new Request(request.url, { method: 'POST', body: form, headers: { cookie: request.headers.get('cookie') ?? '' } }),
  )
}
