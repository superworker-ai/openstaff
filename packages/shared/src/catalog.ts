export const MODEL_CATALOG = [
  { id: 'xai/grok-4.6', name: 'Grok 4.6' },
  { id: 'xai/grok-4.5', name: 'Grok 4.5' },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' },
  { id: 'openai/gpt-5.6-sol', name: 'GPT 5.6 Sol' },
  { id: 'openai/gpt-5.6-luna', name: 'GPT 5.6 Luna' },
  { id: 'opencode-go/kimi-k3', name: 'Kimi K3 (OpenCode Go)' },
  { id: 'opencode-go/glm-5.3', name: 'GLM 5.3 (OpenCode Go)' },
  { id: 'opencode-go/minimax-m3', name: 'MiniMax M3 (OpenCode Go)' },
  { id: 'opencode-go/qwen3.8-max', name: 'Qwen 3.8 Max (OpenCode Go)' },
  { id: 'opencode-go/gpt-5.6-luna', name: 'GPT 5.6 Luna (OpenCode Go)' },
  { id: 'opencode-go/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash (OpenCode Go)' },
  { id: 'opencode/kimi-k3', name: 'Kimi K3 (OpenCode Zen)' },
  { id: 'opencode/minimax-m3', name: 'MiniMax M3 (OpenCode Zen)' },
  { id: 'opencode/glm-5.2', name: 'GLM 5.2 (OpenCode Zen)' },
  { id: 'opencode/deepseek-v4-flash', name: 'DeepSeek V4 Flash (OpenCode Zen)' },
  { id: 'opencode/big-pickle', name: 'Big Pickle (OpenCode Zen, free)' },
] as const
export const PROVIDERS = ['xai', 'anthropic', 'openai', 'opencode', 'composio', 'aiGateway'] as const
export type Provider = typeof PROVIDERS[number]
