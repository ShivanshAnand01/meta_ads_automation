import { NextResponse } from 'next/server'
import { createSupabaseServiceClient, validateSupabaseEnv } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function maskKey(key: string | undefined): string {
  if (!key) return 'missing'
  if (key.length <= 12) return '••••••••'
  return `${key.slice(0, 4)}••••••${key.slice(-4)}`
}

interface StatusResponse {
  envCheck: { ok: boolean; missing: string[] }
  env: {
    NEXT_PUBLIC_SUPABASE_URL: boolean
    NEXT_PUBLIC_SUPABASE_ANON_KEY: boolean
    SUPABASE_SERVICE_ROLE_KEY: string
    DATABASE_URL: boolean
    DIRECT_URL: boolean
    NODE_ENV: string | undefined
  }
  supabase: {
    connected: boolean
    vectorEnabled: boolean
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
      SUPABASE_SERVICE_ROLE_KEY: maskKey(process.env.SUPABASE_SERVICE_ROLE_KEY),
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      DIRECT_URL: Boolean(process.env.DIRECT_URL),
      NODE_ENV: process.env.NODE_ENV,
    },
    supabase: {
      connected: false,
      vectorEnabled: false,
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

    // Check whether pgvector is installed by looking at the data_type of the
    // knowledge_chunks.embedding column (should be vector).
    const { data: columns, error: colError } = await supabase
      .schema('information_schema')
      .from('columns')
      .select('data_type, udt_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'knowledge_chunks')
      .eq('column_name', 'embedding')
    if (!colError && columns && columns.length > 0) {
      const col = columns[0] as { data_type: string; udt_name: string }
      status.supabase.vectorEnabled = col.udt_name === 'vector' || col.data_type === 'USER-DEFINED'
    }

    // List app tables from information_schema.
    const { data: tables, error: tablesError } = await supabase
      .schema('information_schema')
      .from('tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', [
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
      ])

    if (!tablesError && tables) {
      status.supabase.tables = tables.map((t) => (t as { table_name: string }).table_name)
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
