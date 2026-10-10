# Security policy

TradeGuard SI runs on trading pages and can read your wallet's public activity, so we treat security reports as the top priority.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository. Include the steps to reproduce, the impact, and the extension version (`chrome://extensions`).

You'll get an acknowledgement within 3 business days. We'll keep you updated until it's fixed and credit you in the release notes unless you'd rather stay anonymous.

## In scope

- Anything that lets a web page, another extension or a network attacker read or change TradeGuard SI data, settings or lockouts.
- Any path where data leaves the browser that isn't listed in the README's Privacy table.
- Ways to bypass a lockout, locked rules or the site block **without** using the extension's own override flow (disabling the extension or switching browsers is a known limitation, not a vulnerability).
- Prompt-injection from page content that makes the coach act against the trader's rules.

## Out of scope

- The hosted TradeGuard SI service (report those issues the same way; they're handled privately).
- Exchanges and third-party APIs themselves.
