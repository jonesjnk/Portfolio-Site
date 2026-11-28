import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';
import vueDevTools from 'vite-plugin-vue-devtools';
import VueRouter from 'vue-router/vite';

const SITE_URL = 'https://jjank.com';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const sitemap = (): Plugin => ({
  name: 'sitemap',
  apply: 'build',
  generateBundle() {
    const urls = globSync('**/*.vue', { cwd: 'src/pages' })
      .filter((file) => !file.includes('['))
      .map((file) => file.replaceAll('\\', '/').replace(/(?:^|\/)?index\.vue$|\.vue$/u, ''))
      .toSorted()
      .map((path) => `  <url>\n    <loc>${SITE_URL}/${path}</loc>\n  </url>`);

    this.emitFile({
      type: 'asset',
      fileName: 'sitemap.xml',
      source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    });
  },
});

export default defineConfig({
  plugins: [VueRouter(), vue(), vueDevTools(), sitemap()],
  define: {
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(git('rev-parse', '--short', 'HEAD')),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(git('log', '-1', '--format=%cI')),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
