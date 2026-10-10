import { configDefaults, defineConfig } from 'vitest/config';

// .public/ is the exported open-source copy (scripts/export-public.mjs); don't run its tests twice.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, '.public/**', 'server/**'] } });
