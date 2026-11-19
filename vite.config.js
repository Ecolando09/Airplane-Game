import { defineConfig } from 'vite';

// The phone-controller relay (server/relay.js) runs on :8787; in dev and preview
// Vite forwards /ws to it, like the production web server does. (RELAY_PORT
// picks another, for tests run beside a relay that's already going.)
const proxy = { '/ws': { target: `ws://localhost:${process.env.RELAY_PORT || 8787}`, ws: true } };

// Three builds of the same game:
//   vite build                 the website (dist/, or play-dist/ via npm run build:play)
//   vite build --mode psg1     the PSG1 app's built-in copy (dist-psg1/): every city
//                              inside the app so it plays offline, PSG1 screen and
//                              buttons, and the online extras (rooms, leaderboards,
//                              phone controller) through play.latlas.lol when connected.
//   vite build --mode app      the phone app's built-in copy (dist-app/): the website's
//                              game (touch controls), every city, for when the phone has
//                              no internet; online extras through play.latlas.lol.
// __PSG1__ and __BUNDLED__ (inside an app, not on the website) are build-time
// constants, so the website carries none of that code.
export default defineConfig(({ mode }) => {
  const psg1 = mode === 'psg1';
  const app = mode === 'app';
  return {
    base: './',
    define: { __PSG1__: JSON.stringify(psg1), __BUNDLED__: JSON.stringify(psg1 || app) },
    server: { proxy },
    preview: { proxy },
    plugins: psg1 ? [psg1Page()] : app ? [appPage()] : [],
    build: {
      outDir: psg1 ? 'dist-psg1' : app ? 'dist-app' : 'dist',
      rolldownOptions: {
        input: psg1 ? { main: 'index.html', diag: 'psg1/diag.html' } : app ? { main: 'index.html' } : { main: 'index.html', remote: 'remote.html' },
      },
    },
  };
});

/** The phone app's built-in page: the website's, without the Google key file (it only works on the website). */
function appPage() {
  return {
    name: 'app-page',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('index.html')) return html;
        return html.replace(/\s*<script src="\.\/config\.js"><\/script>/, '');
      },
    },
  };
}

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
