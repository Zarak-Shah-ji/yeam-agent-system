/**
 * Outbound transactional mail.
 *
 * One provider (Resend), one function, called over its REST API rather than
 * through the SDK: it is a single POST, and a dependency added for one endpoint
 * is a lockfile entry and a supply-chain surface bought for nothing.
 *
 * Availability is a flag, not a throw, mirroring GEMINI_AVAILABLE in
 * lib/ai/gemini-client.ts. Mail is never the point of the request that triggers
 * it — a verification email is sent from inside a signup that has already
 * committed — so a missing key or a provider outage must degrade to "no mail
 * went out", never to a failed signup. Every caller is expected to ignore the
 * result or log it, and none may branch on it in a way that costs the user
 * their action.
 */

export const EMAIL_AVAILABLE = !!process.env.RESEND_API_KEY

/**
 * Envelope sender. Overridable so a staging deployment can send from somewhere
 * that is not the customer-facing address, but the default is the real one.
 * Resend will refuse anything whose domain is not verified in the account.
 */
export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Yeam <info@yeam.ai>'

export interface SendResult {
  ok: boolean
  /** Present only on failure, and only for logs — never shown to a user. */
  error?: string
}

export async function sendEmail(message: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<SendResult> {
  if (!EMAIL_AVAILABLE) {
    // Not an error worth alarming about: the app is expected to run without a
    // mail provider in development and did so in production until one was set.
    console.warn('[email] RESEND_API_KEY not set; skipped:', message.subject)
    return { ok: false, error: 'not-configured' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    })

    if (!res.ok) {
      // Read the body for the log: Resend explains refusals (unverified domain,
      // invalid address) in it, and without that the failure is unactionable.
      const detail = await res.text().catch(() => '')
      console.error('[email] send failed', res.status, detail.slice(0, 500))
      return { ok: false, error: `http-${res.status}` }
    }

    return { ok: true }
  } catch (err) {
    console.error('[email] send threw', err)
    return { ok: false, error: 'network' }
  }
}
