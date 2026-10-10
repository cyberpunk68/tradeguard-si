// Coach providers for "bring your own key". All three speak the Anthropic Messages API, so the same
// SDK and tool loop work everywhere; only the base URL, the auth header and the model IDs change.
// Verified 2026-10-11:
//   OpenRouter: https://openrouter.ai/api (+ /v1/messages), Authorization: Bearer. Serves Claude,
//               OpenAI, Google, DeepSeek, Qwen… through the same endpoint.
//   OpenCode Zen: https://opencode.ai/zen (+ /v1/messages), x-api-key. Claude and Qwen models only on
//               this endpoint (its GPT/DeepSeek models need other APIs, so they're not offered here).
import { COACH_MODELS } from '../core/defaults';

export type ProviderId = 'anthropic' | 'openrouter' | 'opencode';

export interface ModelOption {
  id: string;
  label: string;
  /** Accepts image input (chart screenshots). */
  vision: boolean;
}

export interface Provider {
  id: ProviderId;
  label: string;
  /** SDK base URL; undefined = Anthropic's default. */
  baseURL?: string;
  /** Host permission to request when the user picks this provider. */
  origin?: string;
  auth: 'x-api-key' | 'bearer';
  keyPlaceholder: string;
  keyHelp: string;
  /** Chat models, cheapest-reasonable first. The first one is the default. */
  chat: ModelOption[];
  /** Default model for on-page auto-checks (one short call per new token). */
  auto: string;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    auth: 'x-api-key',
    keyPlaceholder: 'sk-ant-…',
    keyHelp: 'console.anthropic.com → API keys. Sent only to Anthropic.',
    chat: COACH_MODELS.map((m) => ({ id: m.id, label: m.label, vision: true })),
    auto: 'claude-haiku-5-5',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (Claude, OpenAI, DeepSeek, Qwen…)',
    baseURL: 'https://openrouter.ai/api',
    origin: 'https://openrouter.ai/*',
    auth: 'bearer',
    keyPlaceholder: 'sk-or-…',
    keyHelp: 'openrouter.ai → Keys. Sent only to OpenRouter, which forwards to the model you pick.',
    chat: [
      { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna · cheap, good with tools', vision: true },
      { id: 'qwen/qwen3.8-flash', label: 'Qwen3.8 Flash · cheap', vision: true },
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash · cheapest input, no charts', vision: false },
      { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', vision: true },
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5 · best coach', vision: true },
    ],
    auto: 'openai/gpt-6-luna',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode Zen',
    baseURL: 'https://opencode.ai/zen',
    origin: 'https://opencode.ai/*',
    auth: 'x-api-key',
    keyPlaceholder: 'OpenCode Zen key',
    keyHelp: 'opencode.ai/zen → API keys. Sent only to OpenCode.',
    chat: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 · cheap', vision: true },
      { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash · cheap', vision: false },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 · best coach', vision: true },
    ],
    auto: 'claude-haiku-5-5',
  },
};

export const providerOf = (id: string | undefined): Provider => PROVIDERS[(id as ProviderId) ?? 'anthropic'] ?? PROVIDERS.anthropic;

/** Where each provider's key lives in chrome.storage.local. Anthropic keeps its original key name. */
export const keyStorageName = (id: ProviderId) => (id === 'anthropic' ? 'coachApiKey' : `coachKey:${id}`);

/**
 * Claude-only request features (adaptive thinking, effort, prompt caching) are sent only to Claude
 * models. Other models get a plain request instead of an error.
 */
export const isClaude = (model: string) => /(^|\/)claude-/.test(model);

/** Chart screenshots go only to models known to accept images. Unknown custom models: text only. */
export function acceptsImages(provider: Provider, model: string): boolean {
  if (provider.id === 'anthropic') return true;
  return provider.chat.find((m) => m.id === model)?.vision ?? false;
}
