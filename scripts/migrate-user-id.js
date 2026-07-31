/**
 * Migrate existing text user_id columns to uuid so the current supabase/schema.sql
 * (which assumes uuid) can be applied cleanly.
 */

const { Client } = require('pg')
const fs = require('node:fs')
const path = require('node:path')

const directUrl = process.env.DIRECT_URL
if (!directUrl) {
  console.error('DIRECT_URL is not set')
  process.exit(1)
}

const schemaPath = path.join(process.cwd(), 'supabase', 'schema.sql')
const sql = fs.readFileSync(schemaPath, 'utf8')

async function main() {
  const client = new Client({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()

  // 1. Make sure required extensions are available.
  console.log('Ensuring extensions are enabled...')
  await client.query('CREATE EXTENSION IF NOT EXISTS vector')
  await client.query('CREATE EXTENSION IF NOT EXISTS supabase_vault')
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')

  // 2. Drop all existing policies in public schema; the new schema.sql recreates them.
  console.log('Dropping old RLS policies...')
  const { rows: policies } = await client.query(`
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  `)
  for (const p of policies) {
    await client.query(`DROP POLICY IF EXISTS "${p.policyname}" ON public."${p.tablename}"`)
  }
  console.log(`Dropped ${policies.length} policies.`)

  // 3. Convert user_id columns from text to uuid (idempotent).
  const textToUuidTables = [
    'account_strategy',
    'ad_creatives',
    'ai_actions',
    'ai_conversations',
    'ai_settings',
    'campaigns',
    'daily_metrics',
    'generated_images',
    'knowledge_chunks',
    'knowledge_documents',
    'manager_memory',
    'meta_connections',
    'pending_approvals',
    'scheduled_jobs',
  ]

  for (const table of textToUuidTables) {
    const { rows } = await client.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'user_id'
    `, [table])
    if (rows.length === 0 || rows[0].data_type === 'uuid') {
      console.log(`${table}.user_id already uuid or missing; skipping.`)
      continue
    }
    console.log(`Migrating ${table}.user_id to uuid...`)
    await client.query(`ALTER TABLE public.${table} ALTER COLUMN user_id TYPE uuid USING user_id::uuid`)
  }

  // 4. Convert approval/decision columns to uuid.
  for (const { table, column } of [
    { table: 'ai_actions', column: 'approved_by' },
    { table: 'pending_approvals', column: 'decided_by' },
  ]) {
    const { rows } = await client.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    `, [table, column])
    if (rows.length === 0 || rows[0].data_type === 'uuid') {
      console.log(`${table}.${column} already uuid or missing; skipping.`)
      continue
    }
    console.log(`Migrating ${table}.${column} to uuid...`)
    try {
      await client.query(`ALTER TABLE public.${table} ALTER COLUMN ${column} TYPE uuid USING ${column}::uuid`)
    } catch (e) {
      console.error(`Failed to migrate ${table}.${column}:`, e.message)
      throw e
    }
  }

  // 5. Convert knowledge_chunks.embedding to vector (required for pgvector index).
  const { rows: embeddingRows } = await client.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'knowledge_chunks' AND column_name = 'embedding'
  `)
  if (embeddingRows.length > 0 && embeddingRows[0].data_type !== 'USER-DEFINED') {
    console.log('Converting knowledge_chunks.embedding to vector(1536)...')
    await client.query('DROP INDEX IF EXISTS public.knowledge_chunks_embedding_idx')
    await client.query('ALTER TABLE public.knowledge_chunks ALTER COLUMN embedding TYPE vector(1536) USING NULL')
  }

  // 6. Re-apply the canonical schema.sql as one query.
  // PostgreSQL's simple query protocol correctly parses dollar-quoted functions.
  console.log('Re-applying canonical schema...')
  try {
    await client.query(sql)
  } catch (err) {
    console.error('\nSchema application failed:', err.message)
    throw err
  }

  console.log('Migration complete.')
  await client.end()
}

main().catch((err) => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
