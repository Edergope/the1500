import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  // Sign-in lives in D1. Without this the adapter provisions a KV namespace nothing uses.
  session: false,
  // While a deploy rolls out, a request can reach a different version from the page that asked for it, and a
  // hashed stylesheet then answers 404. Styles travel inside the page, so no page can ever arrive unstyled.
  build: { inlineStylesheets: 'always' },
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react()],
});
