// @ts-check
import { defineConfig } from 'astro/config';

// Static build - the tool is 100% client-side (the installer you drop never leaves the
// browser), so there's no server or adapter. The output in `dist/` is plain static files;
// deploy it anywhere: GitHub Pages, Cloudflare Pages, Netlify, or just `npx serve dist`.
export default defineConfig({
  site: 'https://getrff.com',
});
