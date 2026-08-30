import type { ToolDefinition } from './types'

/**
 * DELIVERY_TOOLS — every tool that touches the live Meta Ads account.
 *
 * These replace the old MCP_TOOLS list, which reached Meta through an MCP
 * subprocess that cannot run on serverless. Everything here is a direct,
 * stateless Graph API call.
 *
 * The important addition is the AD SET and AD layer. Meta's hierarchy is
 * Campaign → Ad Set → Ad, and all three are required: a campaign on its own
 * is an empty container that can never deliver an impression or spend a
 * rupee. The agent must build the whole structure.
 *
 * Spend-affecting actions require approval unless auto-optimize is on, and
 * are additionally checked against the client's budget caps in code.
 */

const SPEND_WARNING =
  '⚠️ SPEND-AFFECTING. Requires user approval unless auto-optimize is enabled, and is rejected outright if it would breach the account budget caps.'

export const DELIVERY_TOOLS: ToolDefinition[] = [
  // ── Reads ───────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_campaigns',
      description:
        'List every campaign on the connected Meta ad account, with budget, objective and effective status. ' +
        'Results are fully paginated. Remember that a campaign with no ad set beneath it cannot deliver — ' +
        'use list_ad_sets to check.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_ad_sets',
      description:
        'List ad sets, optionally filtered to one campaign. The ad set carries targeting, budget, ' +
        'optimization goal and schedule — this is where you diagnose why a campaign is not delivering.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'Meta campaign ID. Omit to list all ad sets on the account.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_ads',
      description:
        'List ads, optionally filtered to one ad set. An ad binds a creative to an ad set and is the object ' +
        'that actually runs. An ad set with no ads will not deliver.',
      parameters: {
        type: 'object',
        properties: {
          adset_id: { type: 'string', description: 'Meta ad set ID. Omit to list all ads on the account.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_creatives',
      description: 'List ad creatives that exist on the Meta ad account (not local drafts).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pages',
      description:
        'List the Facebook Pages this account can advertise from. Every link ad must be published from a Page, ' +
        'so call this before creating a creative if the Page is not already known.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pixels',
      description:
        'List Meta Pixels on the ad account. A pixel is required to optimize for conversions (OFFSITE_CONVERSIONS); ' +
        'without one, conversion campaigns under-deliver and report nothing.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_insights',
      description:
        'Fetch performance insights for the account or a specific object. Conversions and revenue are extracted ' +
        'from the actions/action_values arrays using a single action type, so aliases of the same event are not ' +
        'double-counted. Attribution is pinned to 7-day click / 1-day view so numbers match Meta Ads Manager.',
      parameters: {
        type: 'object',
        properties: {
          object_id: { type: 'string', description: 'Campaign, ad set or ad ID. Omit for the whole account.' },
          level: { type: 'string', description: 'account | campaign | adset | ad. Use "ad" to find which specific ad is losing money.' },
          date_preset: { type: 'string', description: 'today, yesterday, last_7d, last_14d, last_30d, this_month, maximum' },
          time_increment: { type: 'number', description: 'Set to 1 for a day-by-day breakdown.' },
          objective: { type: 'string', description: 'Campaign objective, so the right conversion action type is counted.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_performance',
      description: 'Compare aggregated performance across several campaigns, ad sets or ads over the same window.',
      parameters: {
        type: 'object',
        properties: {
          object_ids: { type: 'array', items: { type: 'string' }, description: 'IDs to compare' },
          level: { type: 'string', description: 'campaign | adset | ad' },
          date_preset: { type: 'string', description: 'Date preset, default last_30d' },
        },
        required: ['object_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_token',
      description:
        'Check whether the Meta access token is valid, which permissions it carries and how many days until it ' +
        'expires. Long-lived tokens last about 60 days and nothing renews them automatically — warn the client ' +
        'when expiry is close.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_account_balance',
      description: 'Current ad account balance, spend cap and amount spent, in the account currency.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'test_meta_connection',
      description:
        'End-to-end connection health check: token validity and expiry, ad account reachability, campaign count, ' +
        'and how many campaigns actually have an ad set and can therefore deliver.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_ad',
      description: 'Get a rendered preview of a live ad so the client can see exactly what it looks like.',
      parameters: {
        type: 'object',
        properties: {
          ad_id: { type: 'string', description: 'Meta ad ID' },
          ad_format: { type: 'string', description: 'e.g. MOBILE_FEED_STANDARD, INSTAGRAM_STORY, DESKTOP_FEED_STANDARD' },
        },
        required: ['ad_id'],
      },
    },
  },

  // ── Targeting research ──────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'search_targeting',
      description:
        'Resolve a place, language or interest name into the Meta targeting ID needed by create_ad_set. ' +
        'ALWAYS use this before building a targeting spec — these IDs are not constants and must never be guessed. ' +
        'Example: search_targeting({query: "Maharashtra", kind: "geo"}) or {query: "Marathi", kind: "locale"}.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name to look up, e.g. "Maharashtra", "Pune", "Marathi", "Online shopping"' },
          kind: { type: 'string', description: 'geo | locale | interest' },
        },
        required: ['query', 'kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estimate_audience_size',
      description:
        'Estimate reachable audience size for a targeting spec before spending anything on it. ' +
        'Use it to sanity-check that targeting is not so narrow it will not deliver, or so broad it wastes budget.',
      parameters: {
        type: 'object',
        properties: {
          targeting: { type: 'object', description: 'Full Meta targeting spec (same shape create_ad_set takes)' },
          optimization_goal: { type: 'string', description: 'Optimization goal the estimate is for' },
        },
        required: ['targeting'],
      },
    },
  },

  // ── Structure creation ──────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_campaign',
      description:
        'Create a campaign on Meta. Created PAUSED by default. ' +
        'IMPORTANT: a campaign alone NEVER delivers — you must also create an ad set (create_ad_set) and at least ' +
        'one ad (create_ad) beneath it. Prefer publish_full_campaign, which builds all three in one step. ' +
        SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Campaign name as it appears in Ads Manager' },
          objective: {
            type: 'string',
            description: 'OUTCOME_SALES, OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_AWARENESS, OUTCOME_APP_PROMOTION',
          },
          status: { type: 'string', description: 'PAUSED (default, safe) or ACTIVE' },
          daily_budget: { type: 'number', description: 'Daily budget in account currency. Set budget at the ad set level instead unless you want campaign budget optimization.' },
          lifetime_budget: { type: 'number', description: 'Lifetime budget in account currency' },
          start_time: { type: 'string', description: 'ISO 8601 start time' },
          end_time: { type: 'string', description: 'ISO 8601 end time' },
          special_ad_categories: {
            type: 'array',
            items: { type: 'string' },
            description:
              'REQUIRED for regulated verticals: EMPLOYMENT, HOUSING, CREDIT, ISSUES_ELECTIONS_POLITICS, ONLINE_GAMBLING_AND_GAMING. ' +
              'Declaring the wrong value can get the ad account restricted. Leave empty for ordinary commercial ads.',
          },
        },
        required: ['name', 'objective'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_ad_set',
      description:
        'Create an ad set inside a campaign. THIS IS THE LAYER THAT MAKES ADS DELIVER: it carries targeting, ' +
        'budget, optimization goal, billing event and schedule. Resolve geo/locale/interest IDs with ' +
        'search_targeting first — never invent them. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Ad set name' },
          campaign_id: { type: 'string', description: 'Meta campaign ID this ad set belongs to' },
          optimization_goal: {
            type: 'string',
            description:
              'OFFSITE_CONVERSIONS (needs a pixel), LANDING_PAGE_VIEWS, LINK_CLICKS, LEAD_GENERATION, REACH, POST_ENGAGEMENT, THRUPLAY, VALUE',
          },
          billing_event: { type: 'string', description: 'IMPRESSIONS (usual), LINK_CLICKS or THRUPLAY' },
          targeting: {
            type: 'object',
            description:
              'Meta targeting spec, e.g. {"geo_locations":{"regions":[{"key":"..."}]},"age_min":18,"age_max":65,"locales":[...],"interests":[{"id":"..."}]}. ' +
              'Use search_targeting to obtain every key/id.',
          },
          daily_budget: { type: 'number', description: 'Daily budget in account currency' },
          lifetime_budget: { type: 'number', description: 'Lifetime budget. Requires end_time.' },
          start_time: { type: 'string', description: 'ISO 8601 start time' },
          end_time: { type: 'string', description: 'ISO 8601 end time. Mandatory with a lifetime budget.' },
          status: { type: 'string', description: 'PAUSED (default) or ACTIVE' },
          promoted_object: {
            type: 'object',
            description: 'Required for conversions: {"pixel_id":"...","custom_event_type":"PURCHASE"}. For lead ads: {"page_id":"..."}.',
          },
        },
        required: ['name', 'campaign_id', 'optimization_goal', 'billing_event', 'targeting'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_ad',
      description:
        'Create an ad that binds an existing creative to an ad set. This is the final object in the hierarchy ' +
        'and the one that actually runs. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Ad name' },
          adset_id: { type: 'string', description: 'Meta ad set ID' },
          creative_id: { type: 'string', description: 'Meta creative ID from create_ad_creative' },
          status: { type: 'string', description: 'PAUSED (default) or ACTIVE' },
        },
        required: ['name', 'adset_id', 'creative_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_ad_creative',
      description:
        'Create an ad creative on Meta from copy plus an image. link_url is REQUIRED — an ad with no real ' +
        'landing page spends the client money sending people nowhere. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Internal creative name' },
          title: { type: 'string', description: 'Headline (max 40 characters)' },
          body: { type: 'string', description: 'Primary text (max 125 characters before truncation)' },
          description: { type: 'string', description: 'Link description (max 30 characters)' },
          image_url: { type: 'string', description: 'Image URL. Must be on the platform storage domain.' },
          link_url: { type: 'string', description: 'REQUIRED. The landing page the ad sends people to.' },
          call_to_action: { type: 'string', description: 'SHOP_NOW, LEARN_MORE, SIGN_UP, DOWNLOAD, BUY_NOW, WHATSAPP_MESSAGE, ...' },
          page_id: { type: 'string', description: 'Facebook Page to publish from. Use list_pages if unknown.' },
        },
        required: ['name', 'title', 'body', 'link_url'],
      },
    },
  },

  // ── Budget & status control ─────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_campaign_budget',
      description:
        'Change a campaign budget. This is how you scale a proven winner. The change is checked against the ' +
        "client's daily and monthly caps and rejected if it would breach them. " + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'Meta campaign ID' },
          daily_budget: { type: 'number', description: 'New daily budget in account currency' },
          lifetime_budget: { type: 'number', description: 'New lifetime budget in account currency' },
        },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_ad_set_budget',
      description:
        'Change an ad set budget — the usual place to scale spend when budget lives at the ad set level. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          adset_id: { type: 'string', description: 'Meta ad set ID' },
          daily_budget: { type: 'number', description: 'New daily budget in account currency' },
          lifetime_budget: { type: 'number', description: 'New lifetime budget in account currency' },
        },
        required: ['adset_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause_campaign',
      description: 'Pause a campaign on Meta so it stops spending immediately. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: { campaign_id: { type: 'string', description: 'Meta campaign ID' } },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume_campaign',
      description:
        'Resume a campaign AND every ad set and ad beneath it. Meta tracks status independently at each level, ' +
        'so resuming only the campaign leaves paused ad sets paused and nothing delivers. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: { campaign_id: { type: 'string', description: 'Meta campaign ID' } },
        required: ['campaign_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_ad_set_status',
      description: 'Pause or resume one ad set — finer control than pausing the whole campaign. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          adset_id: { type: 'string', description: 'Meta ad set ID' },
          active: { type: 'boolean', description: 'true to resume, false to pause' },
        },
        required: ['adset_id', 'active'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_ad_status',
      description: 'Pause or resume a single ad — use this to kill one losing creative without touching the rest. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          ad_id: { type: 'string', description: 'Meta ad ID' },
          active: { type: 'boolean', description: 'true to resume, false to pause' },
        },
        required: ['ad_id', 'active'],
      },
    },
  },

  // ── Audiences ───────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_audiences',
      description: 'List custom and lookalike audiences on the ad account, with approximate sizes.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_custom_audience',
      description: 'Create a custom audience (e.g. website visitors via the pixel). ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Audience name' },
          description: { type: 'string', description: 'What this audience represents' },
          subtype: { type: 'string', description: 'WEBSITE (default), ENGAGEMENT, CUSTOM' },
          retention_days: { type: 'number', description: 'How many days a person stays in the audience (max 180)' },
          rule: { type: 'object', description: 'Targeting rule for WEBSITE audiences' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_lookalike_audience',
      description: 'Create a lookalike audience from an existing source audience. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Audience name' },
          origin_audience_id: { type: 'string', description: 'Source custom audience ID' },
          country: { type: 'string', description: 'Two-letter country code, default IN' },
          ratio: { type: 'number', description: 'Similarity 0.01 (1%, closest match) to 0.10 (10%, broadest)' },
        },
        required: ['name', 'origin_audience_id'],
      },
    },
  },

  // ── One-shot publish ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'publish_full_campaign',
      description:
        'PREFERRED WAY TO GO LIVE. Publishes a local draft campaign to Meta as a complete, deliverable structure: ' +
        'Campaign → Ad Set (with resolved targeting, budget and optimization goal) → one Ad per approved creative. ' +
        'Everything is created PAUSED unless activate is true. Refuses to run without a landing page URL, and ' +
        'refuses conversion optimization without a pixel. ' + SPEND_WARNING,
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Local campaign ID to publish' },
          creativeIds: { type: 'array', items: { type: 'string' }, description: 'Local creative IDs to publish as ads. Defaults to approved creatives on the campaign.' },
          linkUrl: { type: 'string', description: 'Landing page URL. Required unless already stored on the campaign.' },
          pageId: { type: 'string', description: 'Facebook Page to publish from' },
          pixelId: { type: 'string', description: 'Pixel ID, required for conversion optimization' },
          conversionEvent: { type: 'string', description: 'e.g. PURCHASE, LEAD, COMPLETE_REGISTRATION' },
          optimizationGoal: { type: 'string', description: 'Overrides the default derived from the campaign objective' },
          activate: { type: 'boolean', description: 'true to go live immediately. Default false (safe).' },
          targeting: {
            type: 'object',
            description:
              'Plain-language targeting, resolved to Meta IDs automatically: ' +
              '{"regions":["Maharashtra"],"cities":["Pune"],"languages":["Marathi"],"ageMin":22,"ageMax":55,"interests":["Online shopping"]}',
          },
        },
        required: ['campaignId'],
      },
    },
  },
]
