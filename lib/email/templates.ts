/**
 * The mail we send.
 *
 * Inline styles, no external stylesheet, no remote images and no web fonts:
 * mail clients strip <style> blocks, block remote assets by default, and a
 * layout that depends on any of them arrives broken for a large share of
 * readers. Every message ships a plain-text part too — some clients render only
 * that, and a text part is also what keeps a message out of spam filters that
 * treat HTML-only mail as a signal.
 *
 * Colours are stated explicitly rather than inherited. A client in dark mode
 * may invert a background it thinks is default, and a button whose contrast
 * depended on inheritance is the thing that disappears when it does.
 */

export interface EmailBody {
  subject: string
  html: string
  text: string
}

const NAVY = '#0B1220'
const CYAN = '#05DBF0'
const MUTED = '#5A6472'
const BORDER = '#E3E7EC'

/** Shared shell so every message we send looks like it came from one place. */
function layout(inner: string): string {
  return `<div style="margin:0;padding:24px;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid ${BORDER};border-radius:12px;padding:32px;">
    <div style="font-size:18px;font-weight:700;color:${NAVY};letter-spacing:-0.01em;">Yeam</div>
    <div style="height:3px;width:32px;background:${CYAN};margin:10px 0 24px;border-radius:2px;"></div>
    ${inner}
  </div>
  <div style="max-width:520px;margin:16px auto 0;text-align:center;font-size:12px;color:${MUTED};">
    Yeam &middot; denial management for medical billing teams
  </div>
</div>`
}

export function verificationEmail(url: string): EmailBody {
  const html = layout(`
    <div style="font-size:20px;font-weight:600;color:${NAVY};margin-bottom:12px;">Confirm your email</div>
    <p style="font-size:15px;line-height:1.55;color:${NAVY};margin:0 0 20px;">
      You created a Yeam account with this address. Confirm it so we know we can reach
      you about your workspace.
    </p>
    <a href="${url}" style="display:inline-block;background:${NAVY};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">
      Confirm email
    </a>
    <p style="font-size:13px;line-height:1.55;color:${MUTED};margin:22px 0 0;">
      This link works once and expires in 24 hours. If the button does not open, paste
      this into your browser:
    </p>
    <p style="font-size:12px;line-height:1.5;color:${MUTED};margin:6px 0 0;word-break:break-all;">${url}</p>
    <p style="font-size:13px;line-height:1.55;color:${MUTED};margin:22px 0 0;padding-top:18px;border-top:1px solid ${BORDER};">
      If you did not sign up for Yeam, ignore this message — nothing was created in your
      name that this link can reach.
    </p>
  `)

  const text = [
    'Confirm your email',
    '',
    'You created a Yeam account with this address. Confirm it so we know we can',
    'reach you about your workspace.',
    '',
    url,
    '',
    'This link works once and expires in 24 hours.',
    '',
    'If you did not sign up for Yeam, ignore this message.',
  ].join('\n')

  return { subject: 'Confirm your email for Yeam', html, text }
}
