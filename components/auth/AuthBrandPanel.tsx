import Image from 'next/image'
import { Check } from 'lucide-react'

/**
 * Branding for /login and /signup.
 *
 * Copy tracks the yeam.ai marketing site so the app and the website say the
 * same thing. These are the clinic-facing pillars, deliberately not
 * feature/tech bullets — someone signing in already owns the product.
 *
 * The second pillar used to read "HIPAA + HL7 / Certified and secure". There is
 * no HL7 in this codebase and no certification behind that word, so it was
 * replaced with something the product actually does. NOTE: the marketing site
 * still carries the old wording and needs the same correction.
 *
 * The palette is drawn from logo.png (teal #2DD4BF over deep navy) rather
 * than a generic blue, and the mark sits on a white tile because its darker
 * faces would otherwise disappear into the navy background.
 */
const PILLARS = [
  { label: 'Live in days', detail: 'Not a months-long rollout' },
  { label: 'Reads your denials', detail: 'EOB, ERA, or a claims export' },
  { label: 'Works with your EHR', detail: 'No rip and replace' },
  { label: 'No new hires', detail: 'No overtime, no backfill' },
]

export function AuthBrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[linear-gradient(165deg,#143A66_0%,#0E2748_58%,#091B34_100%)] px-12 py-16 md:flex md:w-1/2 md:flex-col md:justify-center">
      {/* Soft teal bloom behind the mark — depth without ornament */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.20),transparent_70%)] blur-2xl"
      />

      <div className="relative mx-auto flex w-full max-w-sm flex-col items-start">
        <div className="flex h-28 w-28 items-center justify-center rounded-3xl bg-white shadow-xl shadow-black/20 ring-1 ring-white/10">
          <Image
            src="/logo.png"
            alt="Yeam.ai"
            width={200}
            height={200}
            priority
            className="h-20 w-20"
          />
        </div>

        <h1 className="mt-8 text-5xl font-semibold tracking-tight text-white">
          Yeam<span className="text-teal-300">.ai</span>
        </h1>

        <p className="mt-4 text-lg leading-relaxed text-slate-300">
          The AI workforce for modern clinics.
        </p>

        <div className="my-9 h-px w-16 bg-white/15" />

        <ul className="w-full space-y-5">
          {PILLARS.map(pillar => (
            <li key={pillar.label} className="flex items-start gap-3.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-400/15 ring-1 ring-teal-400/30">
                <Check className="h-3 w-3 text-teal-300" strokeWidth={3} />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-medium text-white">{pillar.label}</span>
                <span className="mt-0.5 block text-sm text-slate-400">{pillar.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * Compact logo lockup shown above the form on small screens, where the
 * branding panel is hidden. No tile here — the mark reads cleanly on white.
 */
export function AuthMobileHeader() {
  return (
    <div className="flex flex-col items-center gap-2 md:hidden">
      <Image src="/logo.png" alt="Yeam.ai" width={120} height={120} className="h-14 w-14" />
      <h1 className="text-xl font-semibold tracking-tight text-gray-900">
        Yeam<span className="text-teal-500">.ai</span>
      </h1>
    </div>
  )
}
