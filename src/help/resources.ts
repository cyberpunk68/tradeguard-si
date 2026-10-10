// Help resources by region. Kept to services we're confident are current; everywhere else points to
// global directories rather than guessing a number. Review periodically.
export type Region = 'US' | 'CA' | 'UK' | 'IE' | 'AU' | 'OTHER';

export interface Resource {
  name: string;
  what: string;
  contact?: string; // phone / text
  url?: string;
  urgent?: boolean;
}

export const CRISIS: Record<Region, Resource> = {
  US: { name: '988 Suicide & Crisis Lifeline', what: 'Call or text 988, any time, free.', contact: '988', url: 'https://988lifeline.org', urgent: true },
  CA: { name: '9-8-8 Suicide Crisis Helpline', what: 'Call or text 9-8-8, any time, free.', contact: '9-8-8', url: 'https://988.ca', urgent: true },
  UK: { name: 'Samaritans', what: 'Call 116 123 free, any time.', contact: '116 123', url: 'https://www.samaritans.org', urgent: true },
  IE: { name: 'Samaritans Ireland', what: 'Call 116 123 free, any time.', contact: '116 123', url: 'https://www.samaritans.org/ireland/', urgent: true },
  AU: { name: 'Lifeline', what: 'Call 13 11 14, any time.', contact: '13 11 14', url: 'https://www.lifeline.org.au', urgent: true },
  OTHER: { name: 'Find a Helpline', what: 'Free crisis lines in your country.', url: 'https://findahelpline.com', urgent: true },
};

export const GAMBLING: Record<Region, Resource[]> = {
  US: [
    { name: 'National Problem Gambling Helpline', what: 'Confidential, 24/7. Call or text, or chat online.', contact: '1-800-GAMBLER (1-800-426-2537)', url: 'https://www.1800gamblerchat.org' },
    { name: 'Gamblers Anonymous', what: 'Free peer meetings, in person and online.', url: 'https://www.gamblersanonymous.org' },
  ],
  CA: [
    { name: 'Responsible Gambling Council', what: 'Find your province’s free helpline and counselling.', url: 'https://www.responsiblegambling.org' },
    { name: 'ConnexOntario (Ontario)', what: 'Free 24/7 gambling, mental-health and addiction help.', contact: '1-866-531-2600', url: 'https://www.connexontario.ca' },
  ],
  UK: [
    { name: 'National Gambling Helpline (GamCare)', what: 'Free, confidential, 24/7 by phone or live chat.', contact: '0808 8020 133', url: 'https://www.gamcare.org.uk' },
    { name: 'GamStop', what: 'Free self-exclusion from UK-licensed gambling sites.', url: 'https://www.gamstop.co.uk' },
  ],
  IE: [{ name: 'Gambling Therapy', what: 'Free online support and live chat.', url: 'https://www.gamblingtherapy.org' }],
  AU: [
    { name: 'Gambling Help Online', what: 'Free 24/7 counselling by phone, chat or email.', contact: '1800 858 858', url: 'https://www.gamblinghelponline.org.au' },
    { name: 'BetStop', what: 'National self-exclusion register for online wagering.', url: 'https://www.betstop.gov.au' },
  ],
  OTHER: [{ name: 'Gambling Therapy', what: 'Free, multilingual live chat and support worldwide.', url: 'https://www.gamblingtherapy.org' }],
};

export const EVERYWHERE: Resource[] = [
  { name: 'Gambling Therapy', what: 'Free worldwide live chat and peer forums (Gordon Moody).', url: 'https://www.gamblingtherapy.org' },
  { name: 'Gamblers Anonymous', what: 'Free meetings worldwide, including online.', url: 'https://www.gamblersanonymous.org' },
  { name: '6:8 (from the team behind TradeGuard SI)', what: 'Free breathing resets and journaling for the moments after a lockout. A reflection tool, not a substitute for the helplines above.', url: 'https://sixeightapp.com' },
  { name: 'Gamban / BetBlocker', what: 'Blocking software. BetBlocker is free and can block any site you add.', url: 'https://www.betblocker.org' },
];

export function guessRegion(): Region {
  const lang = navigator.language || '';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (/-GB$/i.test(lang) || tz === 'Europe/London') return 'UK';
  if (/-IE$/i.test(lang) || tz === 'Europe/Dublin') return 'IE';
  if (/-AU$/i.test(lang) || tz.startsWith('Australia/')) return 'AU';
  if (/-CA$/i.test(lang) || ['America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax'].includes(tz)) return 'CA';
  if (/-US$/i.test(lang) || /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage)|^Pacific\/Honolulu/.test(tz)) return 'US';
  return 'OTHER';
}
