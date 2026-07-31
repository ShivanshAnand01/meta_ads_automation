/**
 * Cross-platform build script used by `npm run build`.
 *
 * It loads `.env.local` only when present (local development) so Prisma can
 * resolve DIRECT_URL/DATABASE_URL. On Vercel, env vars are injected by the
 * platform and `.env.local` does not exist, so loading is skipped.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')

async function loadLocalEnv() {
  if (!fs.existsSync('.env.local')) return
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile('.env.local')
    }
  } catch {
    // ignored
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  process.exit(result.status ?? (result.error ? 1 : 0))
}

async function main() {
  await loadLocalEnv()

  const prisma = spawnSync('npx', ['prisma', 'generate'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  if (prisma.status !== 0) process.exit(prisma.status ?? 1)

  run('npx', ['next', 'build'])
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
