import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// GitHub Pages serves the project under /<repo-name>/. Override with VITE_BASE
// (e.g. VITE_BASE=/ for a custom domain or local `vite preview`).
const PAGES_BASE = '/WORLDSandboxGame/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.VITE_BASE ?? PAGES_BASE) : '/',
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
