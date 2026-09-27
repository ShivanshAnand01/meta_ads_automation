import type { ToolDefinition } from './types'
import { enabledSpecialists } from './agents/registry'

/**
 * AGENT_TOOLS — how the AI Manager hands work to its specialists. Only the AI
 * Manager has this tool; a specialist's allow-list never includes it, so no
 * specialist can delegate onward.
 */
const team = enabledSpecialists()

export const AGENT_TOOLS: ToolDefinition[] = team.length === 0 ? [] : [
  {
    type: 'function',
    function: {
      name: 'delegate_to_agent',
      description:
        'Hand a focused job to one of your specialists and get back its report (summary, findings with evidence, recommendations). ' +
        'Specialists read data, research and draft; they cannot publish, spend, pause or change budgets — you decide and act on what they report. ' +
        'Give a specific brief: what to find or make, for which product, and anything they must know. ' +
        'Interactive runs wait up to about 90 seconds; for bigger jobs set background true and tell the owner the report will appear on the Agents page.\n\n' +
        'Your team:\n' +
        team.map((s) => `- ${s.id}: ${s.job}`).join('\n'),
      parameters: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: team.map((s) => s.id), description: 'Which specialist.' },
          brief: { type: 'string', description: 'What you need from them, in 1-6 sentences.' },
          background: { type: 'boolean', description: 'Run without waiting for the report. Default false.' },
        },
        required: ['agent', 'brief'],
      },
    },
  },
]
