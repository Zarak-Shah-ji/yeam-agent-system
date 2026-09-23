/**
 * Take a screenshot of a signed-in page.
 *
 * The dashboard is entirely client-rendered behind auth, so `curl` returns a
 * shell with no numbers in it and the only way to see what a biller actually
 * sees is to be a browser. This logs in through the real credentials flow —
 * no cookie forging — and photographs whatever you point it at.
 *
 *   pnpm shot /claims
 *   pnpm shot /claims --as admin@yeam.demo
 *   pnpm shot "/claims?claim=<id>&open=codes" --out detail.png
 *   pnpm shot /settings --click "text=Practice"
 *
 * Shots land in .screenshots/ (gitignored). Full-page by default.
 */
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const path = args.find(a => !a.startsWith('--')) ?? '/claims'

function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const email = flag('as', 'admin@yeam.demo')
const password = flag('password', 'demo1234')
const base = (process.env.NEXTAUTH_URL ?? 'http://localhost:3005').replace(/\/$/, '')
const out = `.screenshots/${flag('out', path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'page')}.png`
const width = Number(flag('width', '1440'))
const click = args.indexOf('--click') >= 0 ? args[args.indexOf('--click') + 1] : null

const main = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width, height: 900 } })

  /*
    Surface the things a screenshot cannot show.

    Hydration errors are treated as failures rather than noise, because they do
    not look like anything. The one that prompted this — a <details> nested in a
    <p>, which the HTML parser silently closes early — rendered a page that
    looked fine in a screenshot while React threw away the server tree and
    re-rendered, flashing the app from dark to light. Nothing in tsc, eslint or
    vitest sees it; only a browser does.
  */
  const hydration: string[] = []
  const noticed = (text: string) => {
    if (/hydrat|cannot be a descendant|cannot contain a nested/i.test(text)) hydration.push(text)
  }
  page.on('console', m => {
    if (m.type() !== 'error') return
    const text = m.text()
    noticed(text)
    console.log('  [console error]', text.slice(0, 200))
  })
  page.on('pageerror', e => {
    noticed(e.message)
    console.log('  [page error]', e.message.slice(0, 200))
  })

  /*
    Logging in is the flaky part, and always for the same reason: in dev the
    first request after an edit compiles the route, so the form can be in the
    DOM a beat before React has wired it up and a click lands on nothing.

    So: wait for the field, submit, and if we are still sitting on /login a few
    seconds later, submit once more before giving up. Retrying a login is
    harmless; failing a screenshot run because the bundler was busy is not.
  */
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })

  const signedIn = () =>
    page
      .waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)

  const submit = async () => {
    await page.waitForSelector('input[type="email"]', { timeout: 30_000 })
    await page.fill('input[type="email"]', email)
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
  }

  if (page.url().includes('/login')) {
    await submit()
    if (!(await signedIn())) {
      if (page.url().includes('/login')) {
        await submit()
        if (!(await signedIn())) {
          const message = await page.locator('[role="alert"]').first().innerText().catch(() => '')
          throw new Error(`Could not sign in as ${email}. ${message}`.trim())
        }
      }
    }
  }

  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })

  // The numbers arrive over tRPC after hydration; a shot taken before they land
  // is a picture of skeletons, which is never the thing being reviewed.
  await page.waitForLoadState('networkidle').catch(() => {})

  if (click) {
    await page.click(click, { timeout: 15_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
  }

  await page.screenshot({ path: out, fullPage: true })
  console.log('wrote', out)
  await browser.close()

  if (hydration.length > 0) {
    console.error(`\n${hydration.length} hydration problem(s) on ${path} — the markup the server`)
    console.error('sent and the markup React expected disagree. Fix before trusting the shot.')
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
