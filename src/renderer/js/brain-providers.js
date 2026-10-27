// Who can answer her chat, as her ring menu lists them (the same ids as src/main/llm.js PROVIDERS):
// which group, what they're called, whether they take a key, whether the answers stay on this PC.

export const GROUPS = ['claude', 'local', 'cloud', 'own'];

export const PROVIDERS = {
  anthropic: { name: 'Claude', group: 'claude', key: true },
  claude: { name: 'Claude Code', group: 'claude' },
  ollama: { name: 'Ollama', group: 'local', local: true },
  lmstudio: { name: 'LM Studio', group: 'local', local: true },
  llamacpp: { name: 'llama.cpp / vLLM', group: 'local', local: true },
  pollinations: { name: 'Pollinations', group: 'cloud' },
  groq: { name: 'Groq', group: 'cloud', key: true },
  gemini: { name: 'Gemini', group: 'cloud', key: true },
  openrouter: { name: 'OpenRouter', group: 'cloud', key: true },
  openai: { name: 'OpenAI', group: 'cloud', key: true },
  mistral: { name: 'Mistral', group: 'cloud', key: true },
  deepseek: { name: 'DeepSeek', group: 'cloud', key: true },
  custom: { name: 'Custom', group: 'own' },
};

export const needsKey = (id) => Boolean(PROVIDERS[id]?.key);
export const isLocal = (id) => Boolean(PROVIDERS[id]?.local);
