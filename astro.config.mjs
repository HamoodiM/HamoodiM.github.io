// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// GitHub Pages placeholders (TODO-USER): set SITE_URL / BASE_PATH in the workflow, or edit here.
//   User site  (repo "HamoodiM.github.io"):  site https://hamoodim.github.io  base "/"
//   Project site (repo "portfolio"):          site https://hamoodim.github.io  base "/portfolio/"
const site = process.env.SITE_URL ?? 'https://hamoodim.github.io';
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  build: { inlineStylesheets: 'auto', assets: '_astro' },
  image: { responsiveStyles: false },
  prefetch: false,
  devToolbar: { enabled: false },
  vite: {
    build: { assetsInlineLimit: 0 },
  },
});
