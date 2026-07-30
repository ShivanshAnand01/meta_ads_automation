import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { normalizeAdAccountId } from '@/lib/meta/user-client'

const GRAPH_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export async function GET() {
  try {
    const userId = await requireUserId()

    const conn = await db.metaConnection.findUnique({
      where: { userId },
    }) as {
      accessToken: string
      adAccountId: string | null
      adAccountName: string | null
      adAccountCurrency: string | null
    } | null

    if (!conn) {
      return Response.json({ connected: false })
    }

    let balance = '0'
    let spendCap = '0'
    let amountSpent = '0'
    let billingHistory: Array<{
      amount: string
      currency: string
      billing_date: string
      status: string
      invoice_url: string
    }> = []

    const actId = conn.adAccountId ? `act_${normalizeAdAccountId(conn.adAccountId)}` : null

    if (actId) {
      try {
        const balanceUrl = `${BASE_URL}/${actId}?fields=balance,spend_cap,amount_spent&access_token=${conn.accessToken}`
        const balanceRes = await fetch(balanceUrl)
        const balanceData = await balanceRes.json()
        if (balanceRes.ok && !balanceData.error) {
          balance = balanceData.balance || '0'
          spendCap = balanceData.spend_cap || '0'
          amountSpent = balanceData.amount_spent || '0'
        }
      } catch {
        balance = '0'
        spendCap = '0'
        amountSpent = '0'
      }

      try {
        const billingUrl = `${BASE_URL}/${actId}/billing_invoices?fields=amount,currency,billing_date,status,invoice_url&access_token=${conn.accessToken}`
        const billingRes = await fetch(billingUrl)
        const billingData = await billingRes.json()
        if (billingRes.ok && !billingData.error) {
          billingHistory = billingData.data || []
        }
      } catch {
        billingHistory = []
      }
    }

    const campaigns = await db.campaign.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        budget: true,
        totalSpend: true,
        budgetType: true,
      },
    })

    return Response.json({
      connected: true,
      adAccount: {
        name: conn.adAccountName || 'Ad Account',
        currency: conn.adAccountCurrency || 'INR',
      },
      balance,
      spendCap,
      amountSpent,
      billingHistory,
      campaignSpend: campaigns,
    })
  } catch (error) {
    return handleError(error, 'Failed to fetch billing info')
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (body.action === 'add_funds') {
      return Response.json({
        success: false,
        message: 'Adding funds requires redirecting to Meta Ads payment portal.',
        redirectUrl: 'https://business.facebook.com/billing/payment',
        amount: body.amount,
      })
    }

    return Response.json(
      { error: 'Unknown action' },
      { status: 400 }
    )
  } catch {
    return Response.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}
