// Bundles TS entry points with esbuild and copies static files into dist/.
// Usage: node scripts/build.mjs [--watch] [--store]
// --store: Chrome Web Store build. Drops the localhost test-harness access (mock pages, adapter hook).
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const store = process.argv.includes('--store');
const isLocal = (pattern) => /^https?:\/\/(localhost|127\.0\.0\.1)[/:]/.test(pattern);
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
// The extension may call its own backend; grant exactly that origin.
{
  const api = new URL(process.env.TG_API_BASE ?? 'https://tradeguard-blond.vercel.app');
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), `${api.origin}/*`])];
  if (store) {
    manifest.host_permissions = manifest.host_permissions.filter((p) => !isLocal(p));
    for (const list of [manifest.content_scripts ?? [], manifest.web_accessible_resources ?? []]) {
      for (const entry of list) entry.matches = entry.matches.filter((p) => !isLocal(p));
    }
    manifest.content_scripts = manifest.content_scripts.filter((c) => c.matches.length);
  }
  writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
}
await import('./icons.mjs');

const options = {
  entryPoints: {
    content: 'src/content/content.ts',
    sw: 'src/background/sw.ts',
    popup: 'src/ui/popup.ts',
    options: 'src/ui/options.ts',
    dashboard: 'src/ui/dashboard.ts',
    sidepanel: 'src/ui/sidepanel.ts',
    blocked: 'src/ui/blocked.ts',
    help: 'src/ui/help.ts',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife', // content scripts must be classic scripts
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  define: { __TG_STORE__: JSON.stringify(store), __TG_API_BASE__: JSON.stringify(process.env.TG_API_BASE ?? 'https://tradeguard-blond.vercel.app') },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
