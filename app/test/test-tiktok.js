/**
 * Tests TikTok — lancer : node test/test-tiktok.js
 * Commentaires uniquement (pas de DM) : OAuth, webhook, normalisation,
 * anti-doublon via file, modération commentaires sensibles.
 */
'use strict';
const assert = require('assert');
const tiktok = require('../server/tiktok');
const Queue = require('../server/queue');

(async () => {
  let n = 0; const ok = (name) => { n++; console.log(`✅ ${name}`); };

  // 1. Mode démo honnête : pas de fausse URL OAuth sans clés
  if (!tiktok.isLive()) assert.strictEqual(tiktok.buildOAuthUrl(), null);
  assert(tiktok.SCOPES.includes('comment.list'));
  ok('TikTok : OAuth prêt (désactivé proprement sans clés)');

  // 2. Normalisation d'un nouveau commentaire (webhook comment.create)
  const evs = tiktok.normalizeWebhook({
    event: 'comment.create',
    content: JSON.stringify({ comment_id: 'tt_c1', video_id: 'v_99', text: 'C\'est combien la robe ?', user: { open_id: 'u1', username: '@boutique.Kinshasa' } }),
  });
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].channel, 'tiktok');
  assert.strictEqual(evs[0].type, 'comment');
  assert.strictEqual(evs[0].videoId, 'v_99');
  ok('TikTok : commentaire entrant normalisé (vidéo + auteur + texte)');

  // 3. Anti-doublon : le même commentaire renvoyé par TikTok n'est traité qu'une fois
  const treated = [];
  const q = new Queue(async (job) => { treated.push(job.externalId); });
  q.push(evs[0]);
  const dup = q.push({ ...evs[0] });
  assert.strictEqual(dup.duplicate, true);
  await new Promise(r => setTimeout(r, 40));
  assert.deepStrictEqual(treated, ['tt_c1']);
  ok('TikTok : anti-doublon webhook');

  // 4. Modération : commentaire sensible -> humain, pas de réponse automatique
  assert.strictEqual(tiktok.needsHuman('C\'est une arnaque ! Je veux un remboursement'), true);
  assert.strictEqual(tiktok.needsHuman('Superbe robe, elle coûte combien ?'), false);
  ok('TikTok : commentaires sensibles détectés (relecture humaine)');

  // 5. Réponse à un commentaire en mode démo = simulée, tracée
  const sent = await tiktok.replyToComment({ account: { token: '' }, commentId: 'tt_c1', videoId: 'v_99', text: 'La robe est à 45 $ 😊' });
  assert.strictEqual(sent.simulated, !tiktok.isLive());
  ok('TikTok : envoi de réponse commentaire (simulé sans clés, réel avec app approuvée)');

  // 6. Événements non-commentaires ignorés proprement
  assert.deepStrictEqual(tiktok.normalizeWebhook({ event: 'user.follow', content: '{}' }), []);
  ok('TikTok : événements hors commentaires ignorés');

  console.log(`\n🎉 ${n}/6 tests réussis — TikTok OK`);
})().catch(e => { console.error('❌ Test en échec :', e); process.exit(1); });
