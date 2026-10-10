import { describe, expect, it } from 'vitest';
import { isChaseLanguage } from '../src/core/chase-language';

describe('chase language', () => {
  it.each([
    'one more trade to get back to even',
    'just need to make it back',
    'win back what I lost',
    'last one I promise',
    'I want to recover the loss',
    'back to break even then I stop',
    "I'm due a win",
  ])('refuses: %s', (t) => expect(isChaseLanguage(t)).toBe(true));
  it.each(['A+ setup: higher low after flush, 3 green 1m candles, stop under 70K', 'planned breakout entry from my morning watchlist'])(
    'allows: %s',
    (t) => expect(isChaseLanguage(t)).toBe(false),
  );
});
