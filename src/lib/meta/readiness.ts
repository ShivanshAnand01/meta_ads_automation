import { db } from '@/lib/db/supabase-db'
import { isApproved } from '@/lib/ai/review-status'
import { checkBudget } from '@/lib/ai/budget-guard'
import { getMetaClientForUser, getMetaConnection, needsMetaConnection } from './user-client'
import { MetaApiError } from './client'
import { META_LIMITS } from '@/lib/ai/structured'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Can this campaign be published right now? Checked BEFORE the owner is asked
 * to approve, because an approval that then fails on Meta teaches the owner to
 * distrust the button. The first real publish failed three times in a row —
 * a missing campaign field, an app in Development mode, no payment method —
 * and each would have been caught here.
 *
 * Nothing in this file creates anything on Meta: the campaign and creative
 * checks use Meta's validate_only mode.
 */

export interface ReadinessIssue {
  /** Stable code the AI and the UI can branch on. */
  code: string
  /** What is wrong, in plain words. */
  problem: string
  /** What the owner does about it. */
  fix: string
  link?: string
}

export interface Readiness {
  ready: boolean
  blockers: ReadinessIssue[]
  warnings: ReadinessIssue[]
  checked: string[]
}

export interface ReadinessInput {
  campaignId: string
  creativeIds?: string[]
  linkUrl?: string
  optimizationGoal?: string
}

const GOAL_BY_OBJECTIVE: Record<string, string> = {
  OUTCOME_SALES: 'OFFSITE_CONVERSIONS',
  OUTCOME_LEADS: 'LEAD_GENERATION',
  OUTCOME_TRAFFIC: 'LANDING_PAGE_VIEWS',
}

function metaDetail(err: unknown): string {
  if (err instanceof MetaApiError) return err.friendlyMessage
  return err instanceof Error ? err.message : 'Unknown error'
}

export async function checkPublishReadiness(userId: string, input: ReadinessInput): Promise<Readiness> {
  const blockers: ReadinessIssue[] = []
  const warnings: ReadinessIssue[] = []
  const checked: string[] = []
  const done = (): Readiness => ({ ready: blockers.length === 0, blockers, warnings, checked })

  // ── The campaign draft ─────────────────────────────────────────────────
  const campaign = (await db.campaign.findUnique({ where: { id: input.campaignId, userId } }).catch(() => null)) as any
  if (!campaign) {
    blockers.push({ code: 'campaign_missing', problem: 'That campaign draft does not exist.', fix: 'Create the campaign draft first.' })
    return done()
  }
  checked.push('campaign draft')

  const linkUrl = input.linkUrl || campaign.linkUrl
  if (!linkUrl) {
    blockers.push({ code: 'no_landing_page', problem: 'The ad has no landing page to send people to.', fix: 'Set a landing page URL in Business Profile or on the campaign.', link: '/business' })
  }

  // ── Meta connection ────────────────────────────────────────────────────
  const conn = await getMetaConnection(userId).catch(() => null)
  const connBlocker = needsMetaConnection(conn)
  if (connBlocker) {
    blockers.push({ code: 'meta_not_connected', problem: connBlocker, fix: 'Connect Meta under Setup → Meta Connection.', link: '/connect' })
    return done()
  }
  if (conn?.tokenExpiry) {
    const days = (new Date(conn.tokenExpiry).getTime() - Date.now()) / 86_400_000
    if (days < 0) blockers.push({ code: 'token_expired', problem: 'The Meta access token has expired.', fix: 'Generate a new token and reconnect under Meta Connection.', link: '/connect' })
    else if (days < 7) warnings.push({ code: 'token_expiring', problem: `The Meta access token expires in ${Math.ceil(days)} day(s).`, fix: 'Reconnect with a fresh token soon; nothing renews it automatically.', link: '/connect' })
  }
  checked.push('Meta connection')

  const client = await getMetaClientForUser(userId)
  const adAccount = conn!.adAccountId
  const goal = input.optimizationGoal || GOAL_BY_OBJECTIVE[campaign.objective] || 'LINK_CLICKS'

  // Independent calls start together; results are read below in a fixed
  // order so the report reads the same every time. (Sequential took ~19 s.)
  const settle = <T,>(p: Promise<T>) => p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
  const healthP = settle(client.getAccountHealth())
  const pagesP = settle(client.getPages())
  const pixelsP = goal === 'OFFSITE_CONVERSIONS' ? settle(client.getPixels()) : null
  const campaignCheckP = settle(client.validateCampaign({ name: campaign.name, objective: campaign.objective || 'OUTCOME_TRAFFIC', status: 'PAUSED', specialAdCategories: [] }))
  const landingP = linkUrl ? settle(fetch(linkUrl, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) })) : null

  // ── Ad account: active, and able to pay ────────────────────────────────
  const healthR = await healthP
  if (healthR.ok) {
    const health = healthR.value
    checked.push('ad account status and payment method')
    if (health.accountStatus != null && health.accountStatus !== 1) {
      blockers.push({
        code: 'account_not_active',
        problem: `The ad account is not active (Meta status ${health.accountStatus}${health.disableReason ? `, reason ${health.disableReason}` : ''}).`,
        fix: 'Open Ads Manager → Account overview and resolve what Meta shows there.',
        link: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccount}`,
      })
    }
    if (!health.hasPaymentMethod) {
      blockers.push({
        code: 'no_payment_method',
        problem: 'The ad account has no payment method, and Meta will not create an ad without one — even a paused ad.',
        fix: 'Add a card, UPI or net banking in Meta Billing. Adding it charges nothing; paused ads spend nothing.',
        link: `https://business.facebook.com/billing_hub/payment_settings?asset_id=${adAccount}`,
      })
    }
  } else {
    warnings.push({ code: 'account_check_failed', problem: `Could not read the ad account's status: ${metaDetail(healthR.error)}`, fix: 'Check the ad account in Ads Manager.' })
  }

  // ── Page ───────────────────────────────────────────────────────────────
  let pageId: string | undefined
  const pagesR = await pagesP
  if (pagesR.ok) {
    const pages = pagesR.value
    checked.push('Facebook Page')
    if (pages.length === 0) {
      blockers.push({ code: 'no_page', problem: 'No Facebook Page is available to publish ads from.', fix: 'Reconnect Meta with a token that includes pages_show_list and pages_manage_ads.', link: '/connect' })
    } else if (pages.length === 1) {
      pageId = pages[0].id
    } else {
      warnings.push({ code: 'several_pages', problem: `This account manages ${pages.length} Pages.`, fix: 'Tell the AI Manager which Page the ad should come from.' })
      pageId = pages[0].id
    }
  } else {
    blockers.push({ code: 'pages_unreadable', problem: `Could not list Facebook Pages: ${metaDetail(pagesR.error)}`, fix: 'Reconnect Meta with Page permissions.', link: '/connect' })
  }

  // ── Optimisation needs a Pixel? ────────────────────────────────────────
  if (pixelsP) {
    const pixelsR = await pixelsP
    if (pixelsR.ok) {
      const pixels = pixelsR.value
      checked.push('Meta Pixel')
      if (pixels.length === 0) {
        blockers.push({
          code: 'no_pixel',
          problem: 'This campaign optimises for sales, which needs a Meta Pixel on the website, and the account has none.',
          fix: 'Install a Pixel on the landing page, or publish as a Traffic campaign (optimised for landing-page views) instead.',
        })
      }
    } else {
      warnings.push({ code: 'pixel_check_failed', problem: `Could not check for a Pixel: ${metaDetail(pixelsR.error)}`, fix: 'Check Events Manager.' })
    }
  }

  // ── Creatives ──────────────────────────────────────────────────────────
  const creatives = (await db.adCreative.findMany({ where: { userId } }).catch(() => [])) as any[]
  const requested = input.creativeIds?.length
    ? creatives.filter((c) => input.creativeIds!.includes(c.id))
    : creatives.filter((c) => c.campaignId === input.campaignId)
  const approved = requested.filter((c) => isApproved(c.reviewStatus))
  checked.push('ad creatives')
  if (requested.length === 0) {
    blockers.push({ code: 'no_creative', problem: 'No ad creative is attached to this campaign.', fix: 'Create a creative (Ad Creatives page, or ask the AI Manager) and attach it.', link: '/creatives' })
  } else if (approved.length === 0) {
    blockers.push({ code: 'creative_not_approved', problem: `None of the ${requested.length} creative(s) is approved.`, fix: 'Approve the creative on the Ad Creatives page. The AI never approves its own work.', link: '/creatives' })
  } else if (approved.length < requested.length) {
    warnings.push({ code: 'some_not_approved', problem: `${requested.length - approved.length} creative(s) are not approved and will be skipped.`, fix: 'Approve them first if you want them in this campaign.', link: '/creatives' })
  }
  for (const c of approved) {
    if (!c.imageUrl) warnings.push({ code: 'creative_no_image', problem: `"${c.title}" has no image.`, fix: 'Generate an image for it; image ads perform far better.', link: '/creatives' })
    if (c.primaryText && [...c.primaryText].length > META_LIMITS.primaryText) warnings.push({ code: 'copy_too_long', problem: `"${c.title}" primary text will be cut off in the feed.`, fix: `Keep it under ${META_LIMITS.primaryText} characters.`, link: '/creatives' })
  }

  // ── Budget vs the owner's caps ─────────────────────────────────────────
  try {
    const budget = await checkBudget(userId, 'publish_full_campaign', { campaignId: input.campaignId })
    checked.push('budget caps')
    if (!budget.allowed) blockers.push({ code: 'over_budget_cap', problem: budget.reason || 'This would exceed your budget caps.', fix: 'Lower the campaign budget or raise the caps in Settings.', link: '/settings' })
  } catch { /* the hard check still runs at publish time */ }

  // ── Meta's own verdict on the exact requests (nothing is created) ──────
  const campaignCheck = await campaignCheckP
  if (campaignCheck.ok) checked.push("Meta's check of the campaign")
  else blockers.push({ code: 'meta_rejects_campaign', problem: `Meta would reject the campaign: ${metaDetail(campaignCheck.error)}`, fix: 'Fix what Meta names above, then check again.' })
  const sample = approved[0]
  if (sample && pageId && linkUrl) {
    try {
      await client.validateAdCreative({
        name: sample.title || 'Ad Creative',
        body: sample.primaryText || sample.description || '',
        title: sample.headline || sample.title || '',
        link: linkUrl,
        callToAction: sample.callToAction || 'LEARN_MORE',
        pageId,
      })
      checked.push("Meta's check of the ad creative")
    } catch (err) {
      blockers.push({ code: 'meta_rejects_creative', problem: `Meta would reject the ad creative: ${metaDetail(err)}`, fix: 'Fix what Meta names above, then check again.' })
    }
  }

  // ── Landing page answers ───────────────────────────────────────────────
  if (landingP) {
    const landing = await landingP
    if (landing.ok) {
      checked.push('landing page')
      if (landing.value.status >= 400) warnings.push({ code: 'landing_page_error', problem: `The landing page answered ${landing.value.status}.`, fix: 'Make sure the page loads; Meta rejects ads that lead to broken pages.' })
    } else {
      warnings.push({ code: 'landing_page_unreachable', problem: 'The landing page did not load within 8 seconds.', fix: 'Check that the link works on a phone.' })
    }
  }

  return done()
}

/** One paragraph the AI Manager and the approval card can show as-is. */
export function describeReadiness(r: Readiness): string {
  if (r.ready && r.warnings.length === 0) return `Ready to publish. Checked: ${r.checked.join(', ')}.`
  const lines: string[] = []
  if (!r.ready) lines.push(`Not ready — ${r.blockers.length} thing(s) must be fixed first:`, ...r.blockers.map((b, i) => `${i + 1}. ${b.problem} Fix: ${b.fix}${b.link ? ` (${b.link})` : ''}`))
  if (r.warnings.length) lines.push('Worth knowing:', ...r.warnings.map((w) => `- ${w.problem} ${w.fix}`))
  return lines.join('\n')
}
