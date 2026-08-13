import { NextResponse } from 'next/server'
import {
  createSupabaseServiceClient,
  validateSupabaseEnv,
} from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function tableExists(supabase: ReturnType<typeof createSupabaseServiceClient>, table: string): Promise<boolean> {
  const { error } = await supabase.from(table).select('id').limit(1)
  // PGRST116 = no rows, which means the table exists and is empty.
  if (!error || error.code === 'PGRST116') return true
  return false
}

interface StatusResponse {
  envCheck: { ok: boolean; missing: string[] }
  env: {
    NEXT_PUBLIC_SUPABASE_URL: boolean
    NEXT_PUBLIC_SUPABASE_ANON_KEY: boolean
    hasServiceRoleKey: boolean
    DATABASE_URL: boolean
    DIRECT_URL: boolean
    NODE_ENV: string | undefined
  }
  supabase: {
    connected: boolean
    vectorEnabled: boolean
    vectorError: string | null
    tables: string[]
    error: string | null
  }
}

export async function GET() {
  const envCheck = validateSupabaseEnv()

  const status: StatusResponse = {
    envCheck: {
      ok: envCheck.ok,
      missing: envCheck.missing,
    },
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      DIRECT_URL: Boolean(process.env.DIRECT_URL),
      NODE_ENV: process.env.NODE_ENV,
    },
    supabase: {
      connected: false,
      vectorEnabled: false,
      vectorError: null,
      tables: [],
      error: null,
    },
  }

  try {
    const supabase = createSupabaseServiceClient()

    // Basic connectivity check using a lightweight table query.
    const { error: healthError } = await supabase.from('meta_connections').select('id').limit(1)
    if (healthError && healthError.code !== 'PGRST116') {
      throw healthError
    }

    status.supabase.connected = true

    // Check core app tables.
    const coreTables = [
      'meta_connections',
      'ai_settings',
      'campaigns',
      'ad_creatives',
      'ai_conversations',
      'ai_messages',
      'ai_notes',
      'scheduled_jobs',
      'account_strategy',
      'manager_memory',
      'ai_actions',
      'daily_metrics',
      'pending_approvals',
      'knowledge_documents',
      'knowledge_chunks',
      'generated_images',
    ]

    const tableChecks = await Promise.all(coreTables.map(async (t) => ({ table: t, exists: await tableExists(supabase, t) })))
    status.supabase.tables = tableChecks.filter((c) => c.exists).map((c) => c.table)

    // Check whether pgvector is usable by calling the semantic search RPC
    // with a zero embedding. If the function/type is missing, this throws.
    if (status.supabase.tables.includes('knowledge_chunks')) {
      const zeroEmbedding = Array(1536).fill(0)
      const { error: vectorError } = await supabase.rpc('match_knowledge_chunks', {
        p_user_id: '00000000-0000-0000-0000-000000000000',
        p_embedding: zeroEmbedding,
        p_match_count: 1,
        p_match_threshold: -1,
      })
      // A data exception / missing function would surface as an error. A normal
      // empty result is not an error.
      status.supabase.vectorEnabled = vectorError === null
      if (vectorError) status.supabase.vectorError = vectorError.message
    }
  } catch (err) {
    status.supabase.error = err instanceof Error ? err.message : String(err)
  }

  const allOk =
    envCheck.ok &&
    status.supabase.connected &&
    status.supabase.tables.includes('knowledge_documents') &&
    status.supabase.tables.includes('knowledge_chunks')

  return NextResponse.json(status, { status: allOk ? 200 : 503 })
}
