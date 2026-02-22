'use client'

import { useEffect } from 'react'
import { Bot, CheckCircle2, AlertTriangle, Loader2, XCircle } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { formatDistanceToNow } from 'date-fns'

const STATUS_ICON: Record<string, React.ReactNode> = {
  COMPLETE: <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />,
  ESCALATED: <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />,
  ERROR: <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />,
  THINKING: <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />,
  WORKING: <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />,
}

const AGENT_COLORS: Record<string, string> = {
  FRONT_DESK: 'bg-purple-100 text-purple-700',
  CLINICAL_DOC: 'bg-teal-100 text-teal-700',
  CLAIM_SCRUBBER: 'bg-orange-100 text-orange-700',
  BILLING: 'bg-green-100 text-green-700',
  ANALYTICS: 'bg-blue-100 text-blue-700',
}

// Explicit log type to avoid deep inference issue with Prisma + tRPC
type AgentLogItem = {
  id: string
  agentName: string
  status: string
  message: string
  confidence: number | null
  createdAt: Date
}

export function AgentActivityFeed() {
  const { data, refetch } = trpc.dashboard.getRecentAgentLogs.useQuery()
  const logs = data as AgentLogItem[] | undefined

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => refetch(), 10_000)
    return () => clearInterval(interval)
  }, [refetch])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2.5">
        <Bot className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-medium text-gray-700">Agent Activity</span>
        <span className="ml-auto h-2 w-2 rounded-full bg-green-400 animate-pulse" title="Live" />
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {!logs || logs.length === 0 ? (
          <div className="p-4 text-xs text-gray-400 text-center">No activity yet</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="px-3 py-2.5 hover:bg-gray-50">
              <div className="flex items-center gap-2 mb-1">
                {STATUS_ICON[log.status] ?? <Bot className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${AGENT_COLORS[log.agentName] ?? 'bg-gray-100 text-gray-600'}`}
                >
                  {log.agentName.replace('_', ' ').toLowerCase()}
                </span>
                <span className="ml-auto text-xs text-gray-400">
                  {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="text-xs text-gray-700 line-clamp-2">{log.message}</p>
              {log.confidence !== null && (
                <div className="mt-1 flex items-center gap-1">
                  <div className="h-1 w-16 rounded-full bg-gray-200">
                    <div
                      className="h-1 rounded-full bg-blue-400"
                      style={{ width: `${Math.round((log.confidence ?? 0) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">
                    {Math.round((log.confidence ?? 0) * 100)}%
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
