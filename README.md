# Meta Ads Platform (AdManager)

AI-powered Meta Ads management dashboard built for the Maharashtrian market.

## Stack

- [Next.js 16](https://nextjs.org/) + [React 19](https://react.dev/)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/) primitives
- [Supabase](https://supabase.com/) — auth + PostgreSQL database
- [Prisma](https://prisma.io/) — schema management and migrations
- [Vercel](https://vercel.com/) — hosting

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in your Supabase credentials and database connection strings.

### 3. Push the schema to Supabase

Make sure `DIRECT_URL` in `.env.local` uses the **Session mode / Direct connection** URI from Supabase (usually port `5432`).

```bash
node --env-file=.env.local node_modules/prisma/build/index.js db push
```

If you previously pushed an older schema with bad foreign keys, reset and push fresh:

```bash
node --env-file=.env.local node_modules/prisma/build/index.js db push --force-reset
```

Then apply permissions and RLS policies:

```bash
node --env-file=.env.local node_modules/prisma/build/index.js db execute --file prisma/grant-permissions.sql
node --env-file=.env.local node_modules/prisma/build/index.js db execute --file prisma/rls-policies.sql
```

This creates all tables in snake_case so they match the runtime Supabase proxy (`src/lib/db/supabase-db.ts`).

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production Deployment on Vercel

### 1. Prepare your Supabase project

- Create or select a Supabase project.
- Copy the **Project URL**, **anon key**, and **service role key**.
- Get the **connection strings** from Settings → Database:
  - `DATABASE_URL` — use the connection pooler URL (port 6543) for the app
  - `DIRECT_URL` — use the direct connection URL (port 5432) for Prisma migrations
- Enable the **pgvector** extension in the Supabase dashboard (Database → Extensions).

### 2. Push the database schema

The canonical schema is `supabase/schema.sql`. Open the Supabase SQL Editor and run the
whole file. It is idempotent and creates all tables, RLS policies, vector indexes, storage
buckets, and helper functions (`match_knowledge_chunks`, `match_memory`, etc.).

```bash
# Local validation (does not apply changes):
node --env-file=.env.local node_modules/prisma/build/index.js validate
```

### 3. Connect GitHub + Vercel for automatic deploys

The project is now a Git repository. To make every change I make automatically reflect on
Vercel:

1. Create a new private repository on GitHub (e.g. `meta-ads-platform`).
2. Push this local repo to it:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/meta-ads-platform.git
   git branch -M main
   git push -u origin main
   ```
3. In the [Vercel dashboard](https://vercel.com/dashboard), open the existing
   `meta-ads-platform` project → **Settings** → **Git** → connect the GitHub repository.
4. Vercel will auto-deploy on every push to `main`.

### 4. Add environment variables in Vercel

In your Vercel project → Settings → Environment Variables, add **for both Production and
Preview**:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `DATABASE_URL` | Supabase pooled connection string |
| `DIRECT_URL` | Supabase direct connection string |
| `RUNNER_SECRET` | Long random string for the AI background runner |
| `VAULT_ENABLED` | `true` |
| `NEXT_TELEMETRY_DISABLED` | `1` |

These are now configured for the existing project for both Production and Preview.

### 5. Deploy

Vercel will run `npm run build` automatically, which executes `scripts/build.js` to generate the Prisma client and build Next.js.

After connecting GitHub, every `git push` will trigger a new Production or Preview
deployment.

### 6. Health check

Visit `/api/status` on your deployed domain to verify that Supabase, the schema, and the
vector columns are healthy.

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server |
| `npm run build` | Create an optimized production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run db:push` | Push schema changes to the database |
| `npm run db:migrate` | Create a new migration |
| `npm run db:deploy` | Deploy pending migrations |

## Project Notes

- **Runtime data layer:** `src/lib/db/supabase-db.ts`. The app queries Supabase directly through a Prisma-like proxy.
- **Database source of truth:** `supabase/schema.sql` — run this in the Supabase SQL Editor to create/reset the full schema (extensions, tables, RLS, vector indexes, storage buckets, helper functions).
- **Prisma schema sync:** `prisma/schema.prisma` mirrors the SQL schema. Vector columns use `Unsupported("vector(1536)")` so Prisma validates but the runtime still uses Supabase directly.
- **Auth:** All pages except `/login` and `/auth/*` are protected by `src/proxy.ts`. Unauthenticated users are redirected to `/login`.
- **Health endpoint:** `/api/status` checks env vars, Supabase connectivity, and whether pgvector/vector columns are present.
- **Agent instructions:** See `AGENTS.md` and `CLAUDE.md` for coding conventions and the AI system prompt.
- **Region:** `vercel.json` targets `bom1` (Mumbai) by default for low latency in Maharashtra. Change it in the Vercel dashboard if you need a different region.
