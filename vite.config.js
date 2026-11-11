import { defineConfig } from 'vite';

// The phone-controller relay (server/relay.js) runs on :8787; in dev and preview
// Vite forwards /ws to it, like the production web server does.
const proxy = { '/ws': { target: 'ws://localhost:8787', ws: true } };

// Two builds of the same game:
//   vite build                 the website (dist/, or play-dist/ via npm run build:play)
//   vite build --mode psg1     the PSG1 app's built-in copy (dist-psg1/): every city
//                              inside the app so it plays offline, PSG1 screen and
//                              buttons, and the online extras (rooms, leaderboards,
//                              phone controller) through play.latlas.lol when connected.
// __PSG1__ is a build-time constant, so the website carries none of the PSG1 code.
export default defineConfig(({ mode }) => {
  const psg1 = mode === 'psg1';
  return {
    base: './',
    define: { __PSG1__: JSON.stringify(psg1) },
    server: { proxy },
    preview: { proxy },
    plugins: psg1 ? [psg1Page()] : [],
    build: {
      outDir: psg1 ? 'dist-psg1' : 'dist',
      rolldownOptions: {
        input: psg1 ? { main: 'index.html', diag: 'psg1/diag.html' } : { main: 'index.html', remote: 'remote.html' },
      },
    },
  };
});

/** The PSG1 page: its own stylesheet, a fixed 620 px wide layout, no Google key file. */
function psg1Page() {
  return {
    name: 'psg1-page',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('index.html')) return html;
        return html
          .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=620, user-scalable=no" />')
          .replace('</head>', '    <link rel="stylesheet" href="./src/psg1.css" />\n  </head>')
          .replace(/\s*<script src="\.\/config\.js"><\/script>/, '');
      },
    },
  };
}
