import { getSupabaseServer } from '@/lib/supabase/server'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Transcribe an audio file (URL) via OpenAI Whisper. */
export async function transcribeAudio(audioUrl: string, whisperKey?: string | null): Promise<{ text?: string; error?: string }> {
  if (!whisperKey) return { error: 'Whisper transcription requires an OpenAI API key (set the Whisper key in AI brain settings). The client uploaded audio but it could not be transcribed.' }
  try {
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) return { error: 'Could not download the audio file.' }
    const blob = await audioRes.blob()
    const form = new FormData()
    form.append('file', blob, 'audio.webm')
    form.append('model', 'whisper-1')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${whisperKey}` },
      body: form,
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { error: `Whisper error: ${res.status} ${t}` }
    }
    const data = await res.json() as any
    return { text: data.text || '' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Transcription failed' }
  }
}

/** Speak text via OpenAI TTS, upload to Supabase storage, return a public URL. */
export async function speak(
  text: string,
  userId: string,
  ttsKey?: string | null,
  voice: string = 'nova'
): Promise<{ audioUrl?: string; error?: string }> {
  if (!ttsKey) return { error: 'Text-to-speech requires an OpenAI API key (set the TTS key in AI brain settings).' }
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ttsKey}` },
      body: JSON.stringify({ model: 'tts-1', input: text.slice(0, 4000), voice, response_format: 'mp3' }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { error: `TTS error: ${res.status} ${t}` }
    }
    const blob = await res.blob()
    const fileName = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`
    const filePath = `${userId}/${fileName}`
    const supabase = await getSupabaseServer()
    const { error: upErr } = await supabase.storage
      .from('voice-clips')
      .upload(filePath, blob, { contentType: 'audio/mpeg', cacheControl: '3600' })
    if (upErr) return { error: `Storage upload failed: ${upErr.message}` }
    const { data: urlData } = supabase.storage.from('voice-clips').getPublicUrl(filePath)
    return { audioUrl: urlData.publicUrl }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'TTS failed' }
  }
}
