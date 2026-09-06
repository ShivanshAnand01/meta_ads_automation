/**
 * Read-only smoke test against the REAL connected Meta account.
 *
 *   npx tsx scripts/smoke-meta-readonly.ts
 *
 * Exercises the app's own code paths — not raw curl — so it proves what the
 * agent will actually experience:
 *   1. Graph client directly (pagination, appsecret_proof, error typing)
 *   2. The MCP bridge (spawns meta-ads-mcp with this user's credentials —
 *      proves the binary starts and whether our argument shapes pass its schema)
 *   3. The dispatcher's MCP-first → Graph fallback routing, with `via`
 *
 * Nothing here creates, updates or pauses anything. Zero spend.
 */
import fs from 'node:fs'
import path from 'node:path'

// Load .env.local before any app module reads process.env.
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=')
  if (i > 0 && !line.startsWith('#')) {
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}
process.env.VAULT_ENABLED = process.env.VAULT_ENABLED ?? 'true'

const USER_ID = process.argv[2] || 'ef47db24-ea14-4d0e-b9a5-9036b052921a'

type Row = { step: string; path: string; ok: boolean; ms: number; detail: string }
const rows: Row[] = []

async function timed<T>(step: string, pathLabel: string, fn: () => Promise<T>, summarize: (r: T) => string): Promise<T | null> {
  const t0 = Date.now()
  try {
    const r = await fn()
    rows.push({ step, path: pathLabel, ok: true, ms: Date.now() - t0, detail: summarize(r) })
    return r
  } catch (err) {
    rows.push({ step, path: pathLabel, ok: false, ms: Date.now() - t0, detail: err instanceof Error ? err.message.slice(0, 160) : String(err) })
    return null
  }
}

const j = (v: unknown) => JSON.stringify(v)

async function main() {
  const { createSupabaseServiceClient } = await import('@/lib/supabase/server')
  const { withServiceClient } = await import('@/lib/db/supabase-db')
  const service = createSupabaseServiceClient()

  await withServiceClient(service, async () => {
    const { getMetaConnection, getMetaClientForUser } = await import('@/lib/meta/user-client')
    const ops = await import('@/lib/meta/ops')
    const { tryMcp } = await import('@/lib/meta/mcp-bridge')
    const { executeTool } = await import('@/lib/ai/tools')
    const { getProfile, buildProfileContext } = await import('@/lib/ai/profile')

    // ── 0. Connection + profile ────────────────────────────────────────
    const conn = await timed('connection', 'db+vault', () => getMetaConnection(USER_ID), (c) =>
      c ? `account act_${c.adAccountId} "${c.adAccountName}" ${c.adAccountCurrency}; token expiry ${c.tokenExpiry}; secrets resolved=${Boolean(c.accessToken && !c.accessToken.startsWith('vault:'))}` : 'NO CONNECTION')
    if (!conn) { print(); return }

    await timed('profile', 'db', () => getProfile(USER_ID), (p) => `${p.businessName} | ${p.primaryLanguageLabel} | ${p.marketRegions.join(',')} | ${p.currency}`)

    // ── 1. Direct Graph client ─────────────────────────────────────────
    const client = await getMetaClientForUser(USER_ID)
    await timed('validate_token', 'graph', () => client.verifyToken(), (t) => `valid=${t.valid} scopes=${(t.scopes || []).join(',')}`)
    const campaigns = await timed('list_campaigns', 'graph', () => client.getCampaigns(), (c) => `${c.length} campaign(s): ${c.slice(0, 3).map((x) => `${x.name}[${x.effective_status}]`).join('; ')}`)
    await timed('list_ad_sets', 'graph', () => client.getAdSets(), (a) => `${a.length} ad set(s): ${a.slice(0, 3).map((x) => `${x.name}[${x.effective_status}] opt=${x.optimization_goal}`).join('; ')}`)
    await timed('list_ads', 'graph', () => client.getAds(), (a) => `${a.length} ad(s)`)
    await timed('list_pages', 'graph', () => client.getPages(), (p) => `${p.length} page(s): ${p.map((x) => x.name).join(', ')}`)
    await timed('list_pixels', 'graph', () => client.getPixels(), (p) => `${p.length} pixel(s): ${p.map((x) => x.name).join(', ')}`)
    await timed('insights_30d', 'graph', () => client.getObjectInsights(`act_${conn.adAccountId}`, 'campaign', { datePreset: 'last_30d' }), (r) => `${r.length} row(s); spend=${r.reduce((s, x) => s + Number(x.spend || 0), 0).toFixed(0)}`)
    await timed('search_geo Maharashtra', 'graph', () => client.searchGeoLocations('Maharashtra', ['region']), (r) => r.slice(0, 2).map((x) => `${x.name}=${x.key}`).join(', ') || 'no match')
    await timed('search_locale Marathi', 'graph', () => client.searchLocales('Marathi'), (r) => r.slice(0, 2).map((x) => `${x.name}=${x.key}`).join(', ') || 'no match')

    // ── 2. MCP bridge (spawns meta-ads-mcp with this user's env) ───────
    await timed('mcp list_campaigns', 'mcp', () => tryMcp('list_campaigns', {}, USER_ID), (a) =>
      a.attempted ? (a.ok ? `OK via MCP: ${j(a.result).slice(0, 140)}` : `MCP rejected → would fall back: ${a.error.slice(0, 140)}`) : `not attempted: ${a.reason}`)
    await timed('mcp get_insights', 'mcp', () => tryMcp('get_insights', { date_preset: 'last_7d', level: 'campaign' }, USER_ID), (a) =>
      a.attempted ? (a.ok ? `OK via MCP: ${j(a.result).slice(0, 140)}` : `MCP rejected → would fall back: ${a.error.slice(0, 140)}`) : `not attempted: ${a.reason}`)
    await timed('mcp validate_token', 'mcp', () => tryMcp('validate_token', {}, USER_ID), (a) =>
      a.attempted ? (a.ok ? `OK via MCP: ${j(a.result).slice(0, 140)}` : `MCP rejected → would fall back: ${a.error.slice(0, 140)}`) : `not attempted: ${a.reason}`)

    // ── 3. Dispatcher end-to-end (guardrails + MCP-first + fallback) ───
    const ctx = { userId: USER_ID, local: { userId: USER_ID, providerType: 'openai' as const }, actor: 'agent' as const }
    for (const tool of ['test_meta_connection', 'list_campaigns', 'list_ad_sets', 'list_pages', 'get_account_balance']) {
      await timed(`dispatch ${tool}`, 'mcp→graph', () => executeTool(ctx, tool, {}), (r) => {
        const o = r as Record<string, unknown>
        return `via=${o?.via ?? '-'}${o?.mcpFallbackReason ? ` (mcp: ${String(o.mcpFallbackReason).slice(0, 80)})` : ''} ${o?.error ? 'ERROR ' + o.error : j(o).slice(0, 110)}`
      })
    }

    const spendish = campaigns && campaigns.length ? `Campaign "${campaigns[0].name}"` : 'no campaigns'
    rows.push({ step: 'note', path: '-', ok: true, ms: 0, detail: `${spendish}. No write operation was attempted.` })
    const profile = await getProfile(USER_ID)
    rows.push({ step: 'profile context', path: '-', ok: true, ms: 0, detail: buildProfileContext(profile).split('\n').slice(0, 4).join(' | ') })
  })
  print()
}

function print() {
  const w = Math.max(...rows.map((r) => r.step.length))
  console.log('\n' + '─'.repeat(100))
  for (const r of rows) console.log(`${r.ok ? '✔' : '✖'} ${r.step.padEnd(w)}  ${r.path.padEnd(10)} ${String(r.ms).padStart(5)}ms  ${r.detail}`)
  console.log('─'.repeat(100))
  const fails = rows.filter((r) => !r.ok).length
  console.log(`${rows.length - fails} passed, ${fails} failed`)
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(2) })
