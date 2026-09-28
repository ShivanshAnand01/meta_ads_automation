/** Today's USD→INR rate (ECB reference, via frankfurter.app, cached a day), or null if unreachable. */
export async function usdToInr(): Promise<{ rate: number; date: string } | null> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR', {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const j = await res.json()
    const rate = Number(j?.rates?.INR)
    return Number.isFinite(rate) && rate > 0 ? { rate, date: String(j.date ?? '') } : null
  } catch {
    return null
  }
}
