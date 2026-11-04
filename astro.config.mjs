import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  // Sign-in lives in D1. Without this the adapter provisions a KV namespace nothing uses.
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react()],
});
