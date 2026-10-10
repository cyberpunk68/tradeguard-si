// Overlay styles. Deliberately quiet: dark ink, one accent per severity, generous spacing.
// The design goal is "a calm friend grabbing your wrist", not a casino alarm.
export const CSS = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
.scrim, .toast {
  --ink: #0a0c10; --card: #12151b; --line: #242a35; --text: #eceef3; --muted: #8b93a5;
  --amber: #f3b74f; --red: #ff6159; --teal: #4fd1a5; --blue: #7aa7ff;
  font: 14px/1.5 ui-sans-serif, -apple-system, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif;
  color: var(--text); -webkit-font-smoothing: antialiased;
}
.scrim {
  position: fixed; inset: 0; pointer-events: auto; display: grid; place-items: center; padding: 16px;
  background: radial-gradient(1200px 600px at 50% 0%, rgba(243,183,79,.08), transparent 60%), rgba(6,8,11,.84);
  backdrop-filter: blur(8px) saturate(.6); -webkit-backdrop-filter: blur(8px) saturate(.6);
  opacity: 0; transition: opacity .18s ease;
}
.scrim.tone-danger { background: radial-gradient(1200px 600px at 50% 0%, rgba(255,97,89,.12), transparent 60%), rgba(6,8,11,.9); }
.scrim.tone-win { background: radial-gradient(1200px 600px at 50% 0%, rgba(79,209,165,.14), transparent 60%), rgba(6,8,11,.88); }
.clock-win { color: var(--teal) !important; }
.hits-win .hit { border-left-color: var(--teal) !important; }
.book { margin-top: 14px; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(79,209,165,.35); background: rgba(79,209,165,.06); display: grid; gap: 8px; }
.book-h { font-weight: 650; color: var(--teal); }
.book-row a { color: var(--teal); }
.book-note { color: #c5cad6; font-size: 13px; }
.book-vault { display: grid; gap: 6px; }
.book-addr { font: 12px ui-monospace, "SF Mono", Menlo, monospace; word-break: break-all; color: var(--text); background: rgba(255,255,255,.04); padding: 6px 8px; border-radius: 8px; }
.btn.small { padding: 7px 10px; font-size: 12px; justify-self: start; }
.override { margin-top: 14px; padding: 12px 14px; border-radius: 12px; border: 1px dashed var(--line); display: grid; gap: 8px; }
.override-reason { font-family: inherit; resize: vertical; }
.hint.refused { color: var(--red); font-weight: 600; }
.seg.seg-2 { grid-template-columns: 1fr 1fr; }
.limits-bad { border-color: rgba(255,97,89,.45); }
.scrim.tone-calm { background: radial-gradient(1200px 600px at 50% 0%, rgba(79,209,165,.08), transparent 60%), rgba(6,8,11,.82); }
.scrim.in { opacity: 1; }
.card {
  width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto;
  background: linear-gradient(180deg, #151922, var(--card)); border: 1px solid var(--line); border-radius: 18px;
  padding: 26px 26px 22px; box-shadow: 0 30px 80px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.04);
  transform: translateY(8px) scale(.985); transition: transform .22s cubic-bezier(.2,.8,.2,1);
}
.scrim.in .card { transform: none; }
.eyebrow { display: flex; gap: 8px; align-items: center; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.brand { font-weight: 700; color: var(--text); letter-spacing: .14em; }
.dot { opacity: .5; }
.lvl-1, .lvl-2 { color: var(--amber); } .lvl-3 { color: #ff9a4f; } .lvl-4 { color: var(--red); } .lvl-0 { color: var(--teal); }
.title { margin: 10px 0 6px; font-size: 23px; line-height: 1.25; font-weight: 650; letter-spacing: -.01em; }
.lede { margin: 0 0 16px; color: var(--muted); }
.moodnote { margin: 10px 0 0; padding: 8px 12px; border-radius: 10px; background: rgba(122,167,255,.08); color: var(--blue); font-size: 13px; }
.hits { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 10px; }
.hit { padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,.025); border: 1px solid var(--line); border-left: 3px solid var(--amber); }
.hit.sev-3 { border-left-color: #ff9a4f; } .hit.sev-4 { border-left-color: var(--red); } .hit.sev-1 { border-left-color: var(--blue); }
.hit-title { font-weight: 600; font-size: 14px; }
.hit-msg { margin: 4px 0 0; color: #c5cad6; font-size: 13.5px; }
.bar { margin: 18px 0 6px; height: 3px; border-radius: 3px; background: var(--line); overflow: hidden; }
.bar-fill { height: 100%; background: var(--amber); transform-origin: left; transition: transform .1s linear; }
.hint { font-size: 12.5px; color: var(--muted); min-height: 18px; }
.phrase { display: grid; gap: 6px; margin-top: 14px; }
.phrase-l { font-size: 12.5px; color: var(--muted); }
.phrase-c { font: 13px/1.4 ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; color: var(--text); background: rgba(255,255,255,.04); padding: 8px 10px; border-radius: 8px; border: 1px dashed var(--line); user-select: none; -webkit-user-select: none; }
.input { width: 100%; font: 14px ui-monospace, "SF Mono", Menlo, monospace; color: var(--text); background: #0d1015; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; outline: none; margin-top: 8px; }
.input:focus { border-color: #3a4252; box-shadow: 0 0 0 3px rgba(122,167,255,.12); }
.input.ok { border-color: rgba(79,209,165,.6); }
.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; flex-wrap: wrap; }
.btn { font: 600 14px/1 inherit; font-family: inherit; border-radius: 11px; padding: 12px 18px; cursor: pointer; border: 1px solid transparent; transition: background .15s, opacity .15s, border-color .15s; }
.btn.primary { background: var(--text); color: #0b0d11; }
.btn.primary:hover { background: #fff; }
.btn.ghost { background: transparent; color: var(--muted); border-color: var(--line); }
.btn.ghost:hover:not(:disabled) { color: var(--text); border-color: #3a4252; }
.btn:disabled { opacity: .35; cursor: not-allowed; }
.btn:focus-visible, .chip:focus-visible, .scale-btn:focus-visible, .seg-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.clock { margin: 18px 0 4px; font: 600 54px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: -.02em; color: var(--red); font-variant-numeric: tabular-nums; }
.mentor { color: #c5cad6; margin: 10px 0 0; }
.scale { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.scale-btn { display: grid; gap: 2px; justify-items: center; padding: 12px 4px; border-radius: 12px; background: rgba(255,255,255,.03); border: 1px solid var(--line); color: var(--text); cursor: pointer; font-family: inherit; }
.scale-btn:hover { border-color: #3a4252; }
.scale-btn.on { border-color: var(--teal); background: rgba(79,209,165,.1); }
.scale-n { font: 600 18px ui-monospace, "SF Mono", Menlo, monospace; }
.scale-l { font-size: 11.5px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.chip { font: 12.5px inherit; font-family: inherit; padding: 6px 11px; border-radius: 999px; background: transparent; color: var(--muted); border: 1px solid var(--line); cursor: pointer; }
.chip.on { color: var(--text); border-color: var(--blue); background: rgba(122,167,255,.1); }
.pending { margin-top: 18px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,.02); }
.pending-q { font-weight: 600; }
.pending-d { color: var(--muted); font-size: 12.5px; margin-bottom: 10px; }
.seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.seg-btn { padding: 9px 4px; border-radius: 10px; background: transparent; border: 1px solid var(--line); color: var(--muted); cursor: pointer; font: 13px inherit; font-family: inherit; }
.seg-btn.on.seg-win { color: var(--teal); border-color: var(--teal); }
.seg-btn.on.seg-loss { color: var(--red); border-color: var(--red); }
.seg-btn.on.seg-breakeven, .seg-btn.on.seg-still-open { color: var(--text); border-color: #3a4252; }
.hit-points { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 3px; }
.hit-points li { position: relative; padding-left: 14px; font-size: 13px; color: var(--text); }
.hit-points li::before { content: ''; position: absolute; left: 2px; top: .6em; width: 5px; height: 5px; border-radius: 50%; background: var(--red); }
.hit-link { display: inline-block; margin-top: 6px; font-size: 12.5px; color: var(--blue); text-decoration: none; }
.hit-link:hover { text-decoration: underline; }
.chip-risk {
  --ink: #0a0c10; --line: #242a35; --text: #eceef3; --muted: #8b93a5; --amber: #f3b74f; --red: #ff6159; --blue: #7aa7ff;
  font: 13px/1.45 ui-sans-serif, -apple-system, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif; color: var(--text);
  position: relative; pointer-events: auto;
  display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px;
  background: #12151b; border: 1px solid var(--line); border-left: 3px solid var(--amber); box-shadow: 0 16px 40px rgba(0,0,0,.45);
  opacity: 0; transform: translateY(6px); transition: opacity .18s, transform .18s;
}
.chip-risk.in { opacity: 1; transform: none; }
.dock { position: fixed; left: 16px; bottom: 16px; width: min(360px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.chip-coach {
  --line: #242a35; --text: #eceef3; --muted: #8b93a5; --amber: #f3b74f; --red: #ff6159; --teal: #4fd1a5; --blue: #7aa7ff;
  font: 13px/1.45 ui-sans-serif, -apple-system, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif; color: var(--text);
  pointer-events: auto; background: #12151b; border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
  box-shadow: 0 16px 40px rgba(0,0,0,.45); opacity: 0; transform: translateY(6px); transition: opacity .18s, transform .18s;
}
.chip-coach.in { opacity: 1; transform: none; }
.chip-coach.cv-avoid { border-color: rgba(255,97,89,.5); }
.cc-top { display: flex; align-items: center; gap: 8px; padding: 10px 10px 6px 12px; }
.cc-badge { font: 800 11px/1 inherit; font-family: inherit; letter-spacing: .1em; padding: 6px 8px; border-radius: 7px; white-space: nowrap; }
.cv-avoid .cc-badge { background: var(--red); color: #1a0606; }
.cv-no_trade .cc-badge { background: #3a2f1c; color: var(--amber); }
.cv-wait .cc-badge { background: #1b2740; color: var(--blue); }
.cv-fits_rules .cc-badge { background: #12302a; color: var(--teal); }
.cc-head { flex: 1; font-weight: 650; line-height: 1.3; }
.cc-reasons { list-style: none; margin: 0; padding: 0 12px 8px; display: grid; gap: 2px; }
.cc-reasons li { position: relative; padding-left: 12px; font-size: 12.5px; color: #c5cad6; }
.cc-reasons li::before { content: ''; position: absolute; left: 1px; top: .6em; width: 4px; height: 4px; border-radius: 50%; background: var(--muted); }
.cc-row { display: grid; grid-template-columns: 56px 1fr; gap: 6px; padding: 6px 12px; border-top: 1px solid var(--line); font-size: 12.5px; }
.cc-row b { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding-top: 2px; font-weight: 600; }
.cc-foot { padding: 6px 12px 8px; font-size: 10.5px; color: var(--muted); border-top: 1px solid var(--line); }
.chip-risk.risk-high { border-left-color: #ff9a4f; }
.chip-risk.risk-extreme { border-left-color: var(--red); background: linear-gradient(180deg, rgba(255,97,89,.08), #12151b); }
.chip-risk .brand { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; padding-top: 2px; font-weight: 700; }
.chip-body { flex: 1; display: grid; gap: 2px; }
.chip-h { font-weight: 650; }
.risk-extreme .chip-h { color: var(--red); }
.chip-d { color: #c5cad6; font-size: 12.5px; }
.chip-body .hit-points { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 3px; }
.hit-points li { position: relative; padding-left: 14px; font-size: 13px; color: var(--text); }
.hit-points li::before { content: ''; position: absolute; left: 2px; top: .6em; width: 5px; height: 5px; border-radius: 50%; background: var(--red); }
.hit-link { margin-top: 2px; }
.toast {
  position: fixed; right: 16px; bottom: 16px; max-width: min(420px, calc(100vw - 32px)); pointer-events: auto;
  display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px;
  background: #12151b; border: 1px solid var(--line); border-left: 3px solid var(--blue); box-shadow: 0 16px 40px rgba(0,0,0,.45);
  opacity: 0; transform: translateY(6px); transition: opacity .18s, transform .18s; font-size: 13px;
}
.toast-warn { border-left-color: var(--amber); }
.toast.in { opacity: 1; transform: none; }
.toast .brand { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; padding-top: 2px; }
.toast-text { flex: 1; color: #c5cad6; }
.toast-x { background: none; border: 0; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
@media (prefers-reduced-motion: reduce) { .scrim, .card, .toast, .bar-fill { transition: none !important; } }
@media (max-width: 480px) { .card { padding: 20px 16px 16px; } .title { font-size: 20px; } .scale-l { display: none; } }
`;
