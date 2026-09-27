import type { ToolDefinition } from './types'

/**
 * INTEGRATION_TOOLS — how the agents reach what the business connected under
 * Setup → Connections (Tavily, Exa, Firecrawl, Apify, fal.ai, custom MCP…).
 *
 * research_web is read-only and runs freely. call_connected_tool can spend a
 * provider's credits (a fal video, an Apify scrape), so it goes through the
 * normal approval gate unless auto-optimize is on.
 */
export const INTEGRATION_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'research_web',
      description:
        'Search the web using the research tool the business connected (Tavily, Exa, Firecrawl, or an MCP search server). ' +
        'Use for competitor research, market prices, trends, reviews, and checking a landing page. Returns titles, URLs and snippets. ' +
        'If nothing is connected it says so: tell the owner they can connect one under Setup → Connections.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for. Be specific: include the product, city or competitor name.' },
          limit: { type: 'number', description: 'Number of results, 1-10. Default 5.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_connected_tools',
      description:
        'List the third-party integrations the business has connected and, for MCP connections, every tool each server offers ' +
        '(name, description, required inputs). Call before call_connected_tool.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Optional: one integration, e.g. "fal" or "custom-my-crm".' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_connected_tool',
      description:
        'Run one tool on a connected MCP server (for example an image or video model on fal.ai, or an Apify scraper). ' +
        'Can spend the provider\'s credits, so it is queued for the owner\'s approval unless auto-optimize is on. ' +
        'Use list_connected_tools first to get exact tool names and inputs.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'The integration, as listed by list_connected_tools.' },
          tool: { type: 'string', description: 'Exact tool name on that server.' },
          arguments: { type: 'object', description: 'Inputs for the tool, matching its schema.' },
          reason: { type: 'string', description: 'One sentence for the owner: why this call, and roughly what it costs.' },
        },
        required: ['slug', 'tool'],
      },
    },
  },
]
