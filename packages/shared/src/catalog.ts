export const MODEL_CATALOG = [
  { id: 'xai/grok-4.6', name: 'Grok 4.6' },
  { id: 'xai/grok-4.5', name: 'Grok 4.5' },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' },
  { id: 'openai/gpt-5.6-sol', name: 'GPT 5.6 Sol' },
  { id: 'openai/gpt-5.6-luna', name: 'GPT 5.6 Luna' },
] as const
export const PROVIDERS = ['xai', 'anthropic', 'openai', 'composio', 'aiGateway'] as const
export type Provider = typeof PROVIDERS[number]
