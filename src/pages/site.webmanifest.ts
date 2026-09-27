import type { APIRoute } from 'astro';

/**
 * The web app manifest, generated rather than static so every path in it runs
 * through the base: a hand-written file under `public/` is necessarily wrong in
 * either local development or production for a site served from a subpath.
 *
 * The colours are the default theme's page ground. The icons are drawn by
 * `npm run brand`.
 */
export const GET: APIRoute = () => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  const manifest = {
    name: 'ARMAG · Firearms reference',
    short_name: 'ARMAG',
    description: 'A free reference for firearms and cartridges where every number is sourced or derived, never guessed.',
    start_url: base,
    scope: base,
    display: 'standalone',
    background_color: '#0a0c10',
    theme_color: '#0a0c10',
    icons: [
      { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
