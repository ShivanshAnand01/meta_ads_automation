/**
 * Apply supabase/schema.sql directly to the Postgres database, statement by statement.
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

// Split on semicolons followed by blank lines to keep function bodies intact.
const statements = sql
  .split(/;\r?\n\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s + ';')
  .map((s) => {
    // Strip leading/trailing comment and blank lines so statements that
    // follow a section comment are still executable.
    const lines = s.split(/\r?\n/)
    while (lines.length && (lines[0].trim().startsWith('--') || lines[0].trim() === '')) {
      lines.shift()
    }
    while (lines.length && (lines[lines.length - 1].trim().startsWith('--') || lines[lines.length - 1].trim() === '')) {
      lines.pop()
    }
    return lines.join('\n')
  })

async function main() {
  const client = new Client({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()
  console.log(`Applying ${statements.length} schema statements...`)

  let applied = 0
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    if (stmt.length < 5) continue
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 80)
    console.log(`[${i + 1}] ${preview}...`)
    try {
      await client.query(stmt)
      applied++
    } catch (err) {
      // Some idempotent statements may conflict (e.g. DROP IF EXISTS on missing object).
      // Surface the statement and error so we can diagnose.
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 120)
      console.error(`\nStatement ${i + 1} failed: ${preview}...`)
      console.error(err.message)
      await client.end()
      process.exit(1)
    }
  }

  console.log(`Schema applied successfully (${applied} statements).`)
  await client.end()
}

main().catch((err) => {
  console.error('Failed to apply schema:', err.message)
  process.exit(1)
})
