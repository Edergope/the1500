import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPublicStats } from '../../../../core/public';

export const GET: APIRoute = async () => {
  const db = env.DB;
  if (!db) return new Response(JSON.stringify({ error: { code: 'DB_NOT_CONFIGURED' } }), {
    status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
  try {
    const stats = await getPublicStats(db);
    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' }
    });
  } catch {
    return new Response(JSON.stringify({ error: { code: 'STATS_UNAVAILABLE' } }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
};
