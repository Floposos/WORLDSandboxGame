import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// GitHub Pages serves the project under /<repo-name>/. Override with VITE_BASE
// (e.g. VITE_BASE=/ for a custom domain).
const PAGES_BASE = '/WORLDSandboxGame/';

// `vite preview` serves the build output, so it must use the same base as the build.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? (process.env.VITE_BASE ?? PAGES_BASE) : '/',
  plugins: [preact()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
