'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Brain, Save, Loader2, CheckCircle2, Cpu, Key, Server, Sparkles } from 'lucide-react'

const providerInfo = {
  anthropic: {
    name: 'Claude (Anthropic)',
    description: 'Best for Marathi ad creative generation. Sonnet 4.5 and Opus 4.1 available. Excellent reasoning.',
    icon: Sparkles,
    needsApiKey: true,
    needsBaseUrl: false,
    defaultBaseUrl: '',
    defaultModel: 'claude-sonnet-4-5-20250514',
  },
  ollama: {
    name: 'Ollama (Local, Free)',
    description: 'Run AI models locally on your machine. No API key needed. Great for getting started.',
    icon: Cpu,
    needsApiKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'llama3',
  },
  openai: {
    name: 'OpenAI GPT',
    description: 'GPT-5.4, GPT-5.4 Mini, and GPT-5.4 Nano available. Good multilingual support including Marathi.',
    icon: Key,
    needsApiKey: true,
    needsBaseUrl: false,
    defaultBaseUrl: '',
    defaultModel: 'gpt-4o-mini',
  },
  groq: {
    name: 'Groq (Llama/Mixtral)',
    description: 'Fast inference with free tier. Good Devanagari script support.',
    icon: Server,
    needsApiKey: true,
    needsBaseUrl: false,
    defaultBaseUrl: '',
    defaultModel: 'llama-3.3-70b-versatile',
  },
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [provider, setProvider] = useState('ollama')
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434')
  // API key is NEVER pre-filled with the masked value. The user types a new key
  // or leaves it blank to keep the existing one. `hasApiKey` tells us if one is
  // already stored so we can show a "Configured" badge.
  const [apiKey, setApiKey] = useState('')
  const [embeddingKey, setEmbeddingKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [hasEmbeddingKey, setHasEmbeddingKey] = useState(false)
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch('/api/settings/ai')
        const json = await res.json()
        if (json.provider) {
          setProvider(json.provider)
          setBaseUrl(json.baseUrl || providerInfo[json.provider as keyof typeof providerInfo].defaultBaseUrl)
          setHasApiKey(Boolean(json.hasApiKey))
          setHasEmbeddingKey(Boolean(json.hasEmbeddingKey))
          setConfigured(true)
        }
      } catch {
      } finally {
        setLoading(false)
      }
    }
    fetchSettings()
  }, [])

  function handleProviderChange(newProvider: string) {
    const info = providerInfo[newProvider as keyof typeof providerInfo]
    setProvider(newProvider)
    setBaseUrl(info.defaultBaseUrl)
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Only include apiKey/embeddingKey in the body if the user typed a new
      // value. An empty string means "keep existing" — the server treats blank
      // as "don't change", but we also omit it entirely for clarity.
      const payload: Record<string, unknown> = {
        provider,
        baseUrl,
        // model is managed in the AI Manager — send the provider default so the
        // DB always holds a valid model when the provider changes.
        model: providerInfo[provider as keyof typeof providerInfo].defaultModel,
      }
      if (apiKey.trim()) payload.apiKey = apiKey.trim()
      if (embeddingKey.trim()) payload.embeddingKey = embeddingKey.trim()

      const res = await fetch('/api/settings/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const json = await res.json()
        toast.success('AI settings saved!')
        setConfigured(true)
        setHasApiKey(Boolean(json.hasApiKey))
        setHasEmbeddingKey(Boolean(json.hasEmbeddingKey))
        setApiKey('')
        setEmbeddingKey('')
      } else {
        const json = await res.json()
        toast.error(json.error || 'Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-32 rounded bg-muted" />
          <div className="h-96 rounded bg-muted" />
        </div>
      </div>
    )
  }

  const currentProvider = providerInfo[provider as keyof typeof providerInfo]
  const CurrentIcon = currentProvider.icon

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold tracking-tight gradient-text">Settings</h1>
        <p className="text-muted-foreground">Configure your AI provider and API key. Choose your model in the AI Manager.</p>
      </motion.div>

      <Card className="glass card-3d">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-bg shadow-md">
              <Brain className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle>AI Brain Configuration</CardTitle>
              <CardDescription>Set your AI provider and API key here. Pick the model in the AI Manager.</CardDescription>
            </div>
          </div>
          {configured && (
            <Badge variant="default" className="w-fit">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Configured
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Provider selection */}
          <div className="space-y-3">
            <Label>AI Provider</Label>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {Object.entries(providerInfo).map(([key, info]) => {
                const Icon = info.icon
                return (
                  <button
                    key={key}
                    onClick={() => handleProviderChange(key)}
                    className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
                      provider === key
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <div>
                      <p className="text-sm font-medium">{info.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{info.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <Separator />

          {/* API key + base URL */}
          <div className="grid gap-4 md:grid-cols-2">
            {currentProvider.needsApiKey && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>API Key</Label>
                  {hasApiKey && (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      Key saved
                    </Badge>
                  )}
                </div>
                <Input
                  type="password"
                  placeholder={hasApiKey ? 'Enter a new key to replace the saved one' : 'Enter your API key'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {hasApiKey ? (
                  <p className="text-xs text-muted-foreground">
                    A key is already saved. Leave blank to keep it, or type a new one to replace it.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {provider === 'anthropic' && <>Get your key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Anthropic Console</a></>}
                    {provider === 'openai' && <>Get your key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">OpenAI Dashboard</a></>}
                    {provider === 'groq' && <>Get your key from <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Groq Console</a></>}
                  </p>
                )}
              </div>
            )}

            {currentProvider.needsBaseUrl && (
              <div className="space-y-2">
                <Label>Ollama Base URL</Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
                <p className="text-xs text-muted-foreground">
                  Install Ollama: <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">ollama.com</a>
                  {' '}and run <code className="rounded bg-muted px-1">ollama pull llama3</code>
                </p>
              </div>
            )}
          </div>

          {/* Embedding key (optional, for RAG) */}
          {provider !== 'openai' && provider !== 'ollama' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Embedding API Key (OpenAI) — optional</Label>
                {hasEmbeddingKey && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    Key saved
                  </Badge>
                )}
              </div>
              <Input
                type="password"
                placeholder={hasEmbeddingKey ? 'Enter a new key to replace the saved one' : 'OpenAI key for RAG embeddings'}
                value={embeddingKey}
                onChange={(e) => setEmbeddingKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Needed for knowledge base (RAG) semantic search. Uses OpenAI text-embedding-3-small.
              </p>
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="gradient-bg animate-gradient shadow-lg card-3d">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save AI Settings
          </Button>
        </CardContent>
      </Card>

      <Card className="glass card-3d">
        <CardHeader>
          <CardTitle>Model Selection</CardTitle>
          <CardDescription>Choose your AI model in the AI Manager</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20">
                <CurrentIcon className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Pick a model in the AI Manager</p>
                <p className="text-xs text-muted-foreground">The model dropdown lives in the AI Manager page so you can switch models while chatting.</p>
              </div>
            </div>
            <Button variant="outline" className="glass card-3d" onClick={() => window.location.href = '/ai-manager'}>
              Go to AI Manager
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
