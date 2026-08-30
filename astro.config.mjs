// @ts-check
import { defineConfig } from 'astro/config';

// Static build - the tool is 100% client-side (the installer you drop never leaves the
// browser), so there's no server or adapter. The output in `dist/` is plain static files;
// deploy it anywhere: GitHub Pages, Cloudflare Pages, Netlify, or just `npx serve dist`.
export default defineConfig({
  site: 'https://getrff.com',
  // Relative asset paths (`./_astro/...`) rather than absolute (`/_astro/...`). The build is
  // published as a downloadable zip whose whole promise is "serve it anywhere", and absolute paths
  // break that the moment it is not the server root - silently, because the HTML still loads and
  // only the CSS and JS 404. Verified by verify-tool-release.mjs on every release.
  build: { assetsPrefix: '.' },
});
