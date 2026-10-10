import { describe, expect, it } from 'vitest';
import { acceptsImages, isClaude, keyStorageName, PROVIDERS, providerOf } from '../src/coach/providers';

describe('coach providers', () => {
  it('treats a missing or unknown provider as Anthropic, so existing users are unchanged', () => {
    expect(providerOf(undefined).id).toBe('anthropic');
    expect(providerOf('nope').id).toBe('anthropic');
    expect(keyStorageName('anthropic')).toBe('coachApiKey');
  });
  it('keeps each provider key under its own name', () => {
    expect(new Set((['anthropic', 'openrouter', 'opencode'] as const).map(keyStorageName)).size).toBe(3);
  });
  it('sends Claude-only features to Claude models only, however the provider spells them', () => {
    expect(isClaude('claude-sonnet-5-5')).toBe(true);
    expect(isClaude('anthropic/claude-haiku-5.5')).toBe(true);
    expect(isClaude('openai/gpt-6-luna')).toBe(false);
    expect(isClaude('qwen3.8-flash')).toBe(false);
  });
  it('sends chart images only to models known to accept them', () => {
    expect(acceptsImages(PROVIDERS.anthropic, 'claude-sonnet-5-5')).toBe(true);
    expect(acceptsImages(PROVIDERS.openrouter, 'openai/gpt-6-luna')).toBe(true);
    expect(acceptsImages(PROVIDERS.openrouter, 'deepseek/deepseek-v4-flash')).toBe(false);
    expect(acceptsImages(PROVIDERS.openrouter, 'some/custom-model')).toBe(false);
  });
  it('OpenRouter authenticates with a Bearer token; Anthropic and OpenCode with x-api-key', () => {
    expect(PROVIDERS.openrouter.auth).toBe('bearer');
    expect(PROVIDERS.opencode.auth).toBe('x-api-key');
    expect(PROVIDERS.anthropic.auth).toBe('x-api-key');
  });
});
