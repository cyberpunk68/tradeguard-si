// Backend origin. Set at build time (TG_API_BASE=https://… npm run build); defaults to production.
declare const __TG_API_BASE__: string;
declare const __TG_STORE__: boolean;
export const API_BASE: string = typeof __TG_API_BASE__ === 'string' ? __TG_API_BASE__ : 'https://tradeguard.si';
/** Chrome Web Store build (`build.mjs --store`): no localhost test-harness hooks. */
export const STORE_BUILD: boolean = typeof __TG_STORE__ === 'boolean' && __TG_STORE__;
