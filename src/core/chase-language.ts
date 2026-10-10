// "One more trade to get back to even" is the sentence that loses the money. If an override
// reason sounds like chasing losses, the override is refused.
const CHASE = [
  /\b(get|getting|win|winning|make|making|earn)\s+(it|that|this|my\s+\w+)?\s*back\b/i,
  /\bback\s+to\s+(even|break\s*-?\s*even|green|where\s+i\s+was)\b/i,
  /\b(break|breaking)\s*-?\s*even\b/i,
  /\bone\s+more\b/i,
  /\b(recover|recoup)\b/i,
  /\b(last|final)\s+(one|trade|try|shot)\b/i,
  /\b(make\s+up\s+for|undo)\b/i,
  /\b(feeling|feel)\s+lucky\b/i,
  /\b(due|owed)\s+(a|for\s+a)\s+win\b/i,
];

export function isChaseLanguage(text: string): boolean {
  return CHASE.some((re) => re.test(text));
}
