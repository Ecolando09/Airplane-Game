import { defineConfig } from 'vite';

// The phone-controller relay (server/relay.js) runs on :8787; in dev and preview
// Vite forwards /ws to it, like the production web server does.
const proxy = { '/ws': { target: 'ws://localhost:8787', ws: true } };

// Relative base so the build works on GitHub Pages or any static host.
export default defineConfig({
  base: './',
  server: { proxy },
  preview: { proxy },
  build: {
    rolldownOptions: {
      input: { main: 'index.html', remote: 'remote.html' },
    },
  },
});
