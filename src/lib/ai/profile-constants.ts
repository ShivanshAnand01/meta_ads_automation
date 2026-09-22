/**
 * Profile constants safe to import from client components.
 *
 * `profile.ts` imports the scoped Supabase client, which drags server-only
 * code into any client bundle that touches it. The language table, currency
 * symbols and formatting helpers have no such dependency, so they live here
 * and `profile.ts` re-exports them.
 */

export type LanguageMode = 'single' | 'mixed'

/**
 * Languages the platform knows how to describe to the model. The label is
 * what actually steers the output: "Marathi (Devanagari script)" produces
 * Devanagari, "Marathi" alone sometimes produces romanised Marathi.
 */
export const LANGUAGES: Record<string, { label: string; script: string; native: string }> = {
  en: { label: 'English', script: 'Latin', native: 'English' },
  hi: { label: 'Hindi (Devanagari script)', script: 'Devanagari', native: 'हिन्दी' },
  mr: { label: 'Marathi (Devanagari script)', script: 'Devanagari', native: 'मराठी' },
  gu: { label: 'Gujarati (Gujarati script)', script: 'Gujarati', native: 'ગુજરાતી' },
  ta: { label: 'Tamil (Tamil script)', script: 'Tamil', native: 'தமிழ்' },
  te: { label: 'Telugu (Telugu script)', script: 'Telugu', native: 'తెలుగు' },
  kn: { label: 'Kannada (Kannada script)', script: 'Kannada', native: 'ಕನ್ನಡ' },
  ml: { label: 'Malayalam (Malayalam script)', script: 'Malayalam', native: 'മലയാളം' },
  bn: { label: 'Bengali (Bengali script)', script: 'Bengali', native: 'বাংলা' },
  pa: { label: 'Punjabi (Gurmukhi script)', script: 'Gurmukhi', native: 'ਪੰਜਾਬੀ' },
  ur: { label: 'Urdu (Nastaliq script)', script: 'Arabic', native: 'اردو' },
  or: { label: 'Odia (Odia script)', script: 'Odia', native: 'ଓଡ଼ିଆ' },
  as: { label: 'Assamese (Bengali-Assamese script)', script: 'Bengali', native: 'অসমীয়া' },
  es: { label: 'Spanish', script: 'Latin', native: 'Español' },
  fr: { label: 'French', script: 'Latin', native: 'Français' },
  de: { label: 'German', script: 'Latin', native: 'Deutsch' },
  pt: { label: 'Portuguese', script: 'Latin', native: 'Português' },
  ar: { label: 'Arabic (Arabic script)', script: 'Arabic', native: 'العربية' },
  id: { label: 'Indonesian', script: 'Latin', native: 'Bahasa Indonesia' },
}

export function languageLabel(code: string): string {
  return LANGUAGES[code]?.label ?? code
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$', JPY: '¥',
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? `${code} `
}

export function formatMoney(amount: number, currency: string): string {
  const symbol = currencySymbol(currency)
  const locale = currency === 'INR' ? 'en-IN' : 'en-US'
  return `${symbol}${Math.round(amount).toLocaleString(locale)}`
}

export const OBJECTIVES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'OUTCOME_SALES', label: 'Sales', hint: 'Purchases on your website. Needs a Pixel.' },
  { value: 'OUTCOME_LEADS', label: 'Leads', hint: 'Form fills, WhatsApp or calls.' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic', hint: 'Visits to a page.' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement', hint: 'Likes, comments, messages.' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness', hint: 'Reach as many people as possible.' },
]

export const CTAS: Array<{ value: string; label: string }> = [
  { value: 'LEARN_MORE', label: 'Learn more' },
  { value: 'SHOP_NOW', label: 'Shop now' },
  { value: 'BUY_NOW', label: 'Buy now' },
  { value: 'SIGN_UP', label: 'Sign up' },
  { value: 'DOWNLOAD', label: 'Download' },
  { value: 'WHATSAPP_MESSAGE', label: 'Send WhatsApp message' },
  { value: 'CALL_NOW', label: 'Call now' },
  { value: 'GET_OFFER', label: 'Get offer' },
  { value: 'SUBSCRIBE', label: 'Subscribe' },
  { value: 'CONTACT_US', label: 'Contact us' },
]

export const ASPECT_RATIOS: Array<{ value: '1:1' | '4:5' | '9:16' | '1.91:1'; label: string; placement: string; css: string }> = [
  { value: '4:5', label: '4:5', placement: 'Feed (portrait)', css: '4 / 5' },
  { value: '1:1', label: '1:1', placement: 'Feed (square)', css: '1 / 1' },
  { value: '9:16', label: '9:16', placement: 'Stories & Reels', css: '9 / 16' },
  { value: '1.91:1', label: '1.91:1', placement: 'Link ad (landscape)', css: '1.91 / 1' },
]

export function aspectCss(ratio: string | null | undefined): string {
  return ASPECT_RATIOS.find((r) => r.value === ratio)?.css ?? '4 / 5'
}
