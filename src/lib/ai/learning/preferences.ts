import { z } from 'zod'
import { getScopedSupabase } from '@/lib/db/supabase-db'
import { generateStructured } from '@/lib/ai/structured'
import { redactSecretText } from '@/lib/redact'
import { learningProvider } from './provider'
import { listLearnings, upsertLearning } from './store'
import { getProfile, buildProfileContext } from '@/lib/ai/profile'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Learning about the owner from their own words.
 *
 * Every few owner messages, the economy model reads the latest ones together
 * with what is already known and returns the updated set of preferences, one
 * per topic, so a preference is refined in place rather than piling up.
 * Only the owner's messages are read — never web pages or tool output — so
 * nothing a third party wrote can become an "owner preference".
 */

export const preferenceSchema = z.object({
  preferences: z
    .array(
      z.object({
        topic: z.string().regex(/^[a-z0-9_]{2,40}$/, 'snake_case topic, 2-40 chars'),
        statement: z.string().min(5).max(240),
        evidence: z.string().max(240).default(''),
        confidence: z.coerce.number().min(0).max(1).default(0.6),
      }),
    )
    .max(15),
})

const SYSTEM = `You maintain a short profile of a business owner for the AI that runs their Facebook and Instagram ads.
From the owner's OWN messages, keep durable facts and preferences that should shape future ads and how the AI works with them:
ad language and script, tone, what they sell and at what price, who their customers are, how customers buy (website, WhatsApp, calls),
likes and dislikes in ads, how they want to be spoken to (short or detailed, which language), timing and schedules.

Rules:
- Only what the owner said or clearly meant. No guesses, no one-off requests ("make this one shorter" is not a preference).
- Temporary states are not preferences: "don't publish yet", "for now", "until I add a card" describe today, not how they always want it.
- The BUSINESS PROFILE you are given is authoritative for the business, its products, market and AD LANGUAGE. Never record a preference that contradicts it.
  The language the owner chats in is NOT the ad language. Documents they ask you to summarise may be about other projects; only their own words count.
- Budgets, spending caps, approvals, auto-optimise and safety rules are SETTINGS, not preferences. Never record anything that loosens them.
- Return the COMPLETE updated list: keep existing ones that still hold, refine them if the owner said more, drop ones the owner contradicted.
- One preference per topic. topic is snake_case (e.g. ad_language, reply_style, price_points, customer_channel).
- Write each statement as a plain instruction or fact, in English, e.g. "Write ad copy in Marathi (Devanagari); keep product names in English."
Respond ONLY with JSON: {"preferences":[{"topic":"...","statement":"...","evidence":"short quote or paraphrase","confidence":0.0-1.0}]}`

export async function extractOwnerPreferences(userId: string): Promise<{ updated: number; error?: string }> {
  const llm = await learningProvider(userId, 'learning:preferences')
  if (!llm) return { updated: 0, error: 'No AI provider configured' }

  const supabase = await getScopedSupabase()
  const { data: convs } = await supabase
    .from('ai_conversations').select('id').eq('user_id', userId).eq('autonomous', false)
    .order('updated_at', { ascending: false }).limit(10)
  const convIds = ((convs ?? []) as any[]).map((c) => c.id)
  if (convIds.length === 0) return { updated: 0 }

  const { data: msgs } = await supabase
    .from('ai_messages').select('content, created_at').in('conversation_id', convIds).eq('role', 'user')
    .order('created_at', { ascending: false }).limit(25)
  // Only what the owner typed. The chat stores attached files' text after an
  // "[Attached: …]" marker in the same message; a business plan for another
  // project once became "the ads are for Sarathi" this way.
  const ownerLines = ((msgs ?? []) as any[])
    .reverse()
    .map((m) => redactSecretText(String(m.content ?? '').split(/\n\n\[Attached:/)[0]).trim().slice(0, 600))
    .filter((t) => t.length > 2)
  if (ownerLines.length === 0) return { updated: 0 }

  const known = await listLearnings(userId, { status: ['active'], kinds: ['owner_preference'], limit: 30 })
  const knownText = known.length
    ? known.map((k) => `- ${k.signature.replace(/^pref:/, '')}: ${k.statement}`).join('\n')
    : '(none yet)'

  const profile = await getProfile(userId).then(buildProfileContext).catch(() => '')
  const prompt = `${profile || 'BUSINESS PROFILE: (not set)'}\n\nWhat is already known about the owner:\n${knownText}\n\nThe owner's latest messages (oldest first):\n${ownerLines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`
  let result: z.infer<typeof preferenceSchema>
  try {
    result = await generateStructured(llm.provider, preferenceSchema, prompt, SYSTEM)
  } catch (err) {
    return { updated: 0, error: err instanceof Error ? err.message : 'extraction failed' }
  }

  let updated = 0
  for (const p of result.preferences) {
    await upsertLearning({
      userId,
      kind: 'owner_preference',
      signature: `pref:${p.topic}`,
      statement: p.statement,
      source: 'chat',
      detail: { evidence: p.evidence },
      confidence: p.confidence,
    })
    updated++
  }
  return { updated }
}

/** Run extraction every Nth owner message in a conversation — frequent enough to learn, cheap enough to ignore. */
export const PREFERENCE_EVERY_N_MESSAGES = 4
