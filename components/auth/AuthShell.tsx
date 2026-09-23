import Image from 'next/image'

/**
 * The frame around /login and /signup.
 *
 * Replaces the old 50/50 split (navy brand panel + white form). That layout
 * spent half the viewport on marketing bullets aimed at someone who, by
 * definition, already owns the product — and one of them ("Live in days") was
 * a sales claim sitting on a sign-in screen. This is one full-bleed canvas
 * with a single card on it: mark, name, the form, nothing else.
 *
 * The wordmark is "yeam", lowercase. The ".ai" suffix is a domain, not the brand.
 *
 * Palette is sampled straight off the mark: the three drifting fields are its
 * three faces — highlight cyan #05DBF0, right face #057FCF, left face #07538F —
 * over deep navy. An earlier pass used teal + violet, which was wrong twice:
 * teal was tuned to the OLD logo.png and carries green the new mark has none
 * of, and violet appears nowhere in the brand at all. Teal-and-purple gradients
 * are also the house style of every generated landing page on the internet,
 * which is its own argument against them.
 *
 * The mark is /logo-hd.png, the 512px alpha-cut asset from the marketing site
 * (yeam_website/public/logo-hd.png) rather than the app's older /logo.png. It
 * sits bare on the aurora: the white tile it used to need was there because the
 * old mark's dark faces vanished against navy, and this one's don't. Note the
 * HD_LOGO.png in the repo root is the same artwork with an opaque near-black
 * background baked in — it cannot be used on a coloured surface.
 *
 * Type is Plus Jakarta Sans, the marketing site's face, via .font-brand.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <div className="font-brand theme-static relative flex min-h-screen items-center justify-center overflow-hidden bg-[#060E1B] px-5 py-12">
      <AuthAurora />

      <div className="auth-card-in relative z-10 w-full max-w-[25rem]">
        <div className="relative rounded-[1.25rem] border border-white/10 bg-white/[0.045] p-8 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.75)] backdrop-blur-2xl sm:p-9">
          {/* Hairline catching the light along the card's top edge — the one
              detail that sells the glass as having thickness. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
          />

          <div className="flex flex-col items-center text-center">
            <Image
              src="/logo-hd.png"
              alt=""
              width={512}
              height={512}
              priority
              className="h-[4.5rem] w-[4.5rem] drop-shadow-[0_6px_22px_rgba(5,219,240,0.30)]"
            />

            <h1 className="mt-4 text-[2.125rem] font-extrabold leading-none tracking-[-0.035em] text-white">
              yeam
            </h1>
            <p className="mt-3 text-sm font-medium text-slate-400">{subtitle}</p>
          </div>

          <h2 className="sr-only">{title}</h2>

          <div className="mt-8">{children}</div>
        </div>

        <div className="mt-6 text-center text-sm text-slate-400">{footer}</div>
      </div>
    </div>
  )
}

/**
 * The moving part. Three colour fields on offset loops over a fixed navy base,
 * a vignette to pull the eye back to the middle, and grain over everything.
 *
 * Deliberately zero JavaScript — no canvas, no rAF, no mount effect. It costs
 * nothing on the critical path of the one page a user cannot skip, and it
 * cannot tear or stutter under a slow hydration.
 *
 * Every field carries a negative animation-delay so the page opens partway
 * into the swing. Started at 0 the three fields sit at the corners of their
 * travel, which is the emptiest frame of the whole loop — the one moment it
 * should never be is the moment it loads.
 */
function AuthAurora() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The highlight face. Largest field and slowest loop — it should feel
          like the ambient colour of the page. */}
      <div
        className="aurora-field -left-[18vmax] -top-[22vmax] h-[78vmax] w-[78vmax] bg-[radial-gradient(circle_at_center,rgba(5,219,240,0.50),rgba(5,219,240,0.15)_40%,transparent_70%)]"
        style={{ animationName: 'aurora-drift-a', animationDuration: '29s', animationDelay: '-8s' }}
      />

      {/* The right face, bottom-right, counter-drifting against the cyan so the
          two cross the centre rather than travelling together. */}
      <div
        className="aurora-field -bottom-[26vmax] -right-[16vmax] h-[70vmax] w-[70vmax] bg-[radial-gradient(circle_at_center,rgba(5,127,207,0.58),rgba(5,127,207,0.18)_42%,transparent_72%)]"
        style={{ animationName: 'aurora-drift-b', animationDuration: '37s', animationDelay: '-18s' }}
      />

      {/* The left face: smallest, darkest, and the reason the card has anything
          to sit against. Reads as shadow with a colour rather than as a glow. */}
      <div
        className="aurora-field left-[22vmax] top-[14vmax] h-[54vmax] w-[54vmax] bg-[radial-gradient(circle_at_center,rgba(11,76,143,0.62),transparent_68%)]"
        style={{ animationName: 'aurora-drift-c', animationDuration: '43s', animationDelay: '-12s' }}
      />

      {/* Vignette — darkens the corners the fields drift through, so the card
          always sits on the brightest part of the frame. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_38%,rgba(4,9,18,0.62)_100%)]" />

      <div className="aurora-grain absolute inset-0" />
    </div>
  )
}
