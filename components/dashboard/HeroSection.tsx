'use client'

import { CommandBar } from '@/components/layout/CommandBar'
import { useChat } from '@/components/layout/chat-context'
import { cn } from '@/lib/utils'

const examplePrompts = [
  'Show me the appointment schedule',
  'Show me pending claims',
  'Draft a SOAP note for patient MRN-001 for a hypertension follow-up visit',
  'What\'s the denial rate across all Medicaid encounters?',
]

export function HeroSection() {
  const { submit, isStreaming } = useChat()

  return (
    <section className="flex flex-col items-center text-center pt-10 pb-4 px-4">
      <h1 className="text-4xl font-bold text-gray-900 mb-1">
        Ask anything about your clinic
      </h1>
      <p className="text-sm text-gray-500 mb-8 max-w-md">
        Patients, appointments, claims, billing - one agent handles it all.
      </p>

      <CommandBar className="w-full max-w-2xl flex-none" />

      <div className="flex flex-wrap justify-center gap-2 mt-5">
        {examplePrompts.map(prompt => (
          <button
            key={prompt}
            onClick={() => submit(prompt)}
            disabled={isStreaming}
            className={cn(
              'rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500 shadow-sm transition-colors',
              isStreaming
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 cursor-pointer',
            )}
          >
            {prompt}
          </button>
        ))}
      </div>
    </section>
  )
}
