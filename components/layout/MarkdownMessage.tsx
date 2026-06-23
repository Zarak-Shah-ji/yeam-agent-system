import { Fragment, type ReactNode } from 'react'

// Minimal, dependency-free markdown renderer for agent responses.
// Supports: bold (**), italic (*), inline code (`), bullet/numbered lists,
// and paragraphs. Renders only text + known elements — never raw HTML — so
// it is XSS-safe by construction.

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // Order matters: match code spans first so backticked text isn't re-parsed.
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g
  let lastIndex = 0
  let key = 0
  let m: RegExpExecArray | null

  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={key++} className="font-semibold">{tok.slice(2, -2)}</strong>)
    } else {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let items: { depth: number; text: string }[] = []
  let listType: 'ul' | 'ol' | null = null
  let key = 0

  const flushList = () => {
    if (items.length === 0) return
    const Tag = (listType === 'ol' ? 'ol' : 'ul') as 'ol' | 'ul'
    const captured = items
    blocks.push(
      <Tag
        key={key++}
        className={listType === 'ol' ? 'list-decimal pl-5 space-y-0.5' : 'list-disc pl-5 space-y-0.5'}
      >
        {captured.map((it, i) => (
          <li key={i} style={it.depth > 0 ? { marginLeft: it.depth * 12 } : undefined}>
            {renderInline(it.text)}
          </li>
        ))}
      </Tag>,
    )
    items = []
    listType = null
  }

  for (const raw of lines) {
    const bullet = raw.match(/^(\s*)[-*]\s+(.*)$/)
    const numbered = raw.match(/^(\s*)\d+\.\s+(.*)$/)

    if (bullet) {
      if (listType === 'ol') flushList()
      listType = 'ul'
      items.push({ depth: Math.floor(bullet[1].length / 2), text: bullet[2] })
      continue
    }
    if (numbered) {
      if (listType === 'ul') flushList()
      listType = 'ol'
      items.push({ depth: Math.floor(numbered[1].length / 2), text: numbered[2] })
      continue
    }

    flushList()
    if (raw.trim() === '') continue
    blocks.push(<p key={key++}>{renderInline(raw)}</p>)
  }
  flushList()

  return <div className="space-y-1.5 leading-relaxed">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}
