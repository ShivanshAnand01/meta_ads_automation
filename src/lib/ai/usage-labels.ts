import { getSpecialist } from './agents/registry'

/** A plain-English name for an ai_usage source, for the developer's cost views. */
export function sourceLabel(source: string): string {
  if (source.startsWith('agent:')) return getSpecialist(source.slice(6))?.name ?? source
  if (source.startsWith('autonomous:')) return `Scheduled routine · ${source.slice(11).replace(/_/g, ' ')}`
  const fixed: Record<string, string> = {
    chat: 'AI Manager chat',
    autonomous: 'Scheduled routines',
    reflection: 'Nightly reflection',
    approvals: 'Approved actions',
    image: 'Images made in chat',
    'creative:generate': 'Creatives page · generate',
    'creative:review': 'Creatives page · review',
    'creative:suggest': 'Creatives page · suggestions',
  }
  return fixed[source] ?? source
}
