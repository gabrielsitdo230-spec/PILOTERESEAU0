/**
 * PILOTE RÉSEAU — Worker Cloudflare (Étape A : socle uniquement)
 * ---------------------------------------------------------------
 * Ce fichier ne remplace PAS encore le serveur Node (app/server).
 * Il prouve le tuyau : le Worker répond, voit la base D1 et le KV.
 * Les vraies routes (auth, assistants, savoirs, crédits, paiements,
 * webhooks) arrivent à l'Étape C, une par une, avec les tests.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/worker/health') {
      let db = 'non-liée';
      try {
        if (env.DB) {
          const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
          db = 'ok (' + (r.results || []).map(x => x.name).join(', ') + ')';
        }
      } catch (e) { db = 'erreur: ' + e.message; }
      return Response.json({
        ok: true,
        service: 'Pilote Réseau — Worker (Étape A)',
        d1: db,
        kv: env.PILOTE_KV ? 'lié' : 'non-lié',
        note: 'Backend Node toujours actif : aucune fonctionnalité migrée à ce stade.',
      });
    }

    // Les pages statiques sont servies par l'asset binding (voir wrangler.jsonc)
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Pilote Réseau — Étape A', { status: 200 });
  },
};
