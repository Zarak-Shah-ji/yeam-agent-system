import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A labelled input sized and coloured for the glass card on /login and /signup.
 *
 * The shared <Input> is built for white surfaces — grey border, white fill,
 * blue focus ring — all three of which disappear or clash on the aurora. Rather
 * than add a dark variant to a primitive used in ~40 places across the
 * dashboard, the two auth pages override it here, in one place.
 */
export function AuthField({
  id,
  label,
  className,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[0.8125rem] font-medium text-slate-300">
        {label}
      </label>
      <Input
        id={id}
        className={cn(
          'h-10 rounded-lg border-white/15 bg-white/[0.06] text-white shadow-none',
          'placeholder:text-slate-500',
          'focus-visible:border-[#05DBF0]/55 focus-visible:ring-[#05DBF0]/40',
          'transition-colors hover:border-white/25',
          className
        )}
        {...props}
      />
    </div>
  )
}

/** "or continue with email" — a rule with the label knocked out of the middle. */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-white/10" />
      <span className="text-[0.6875rem] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  )
}

/** Failed sign-in. Red at the saturation the rest of the card is tuned to. */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      {children}
    </p>
  )
}
