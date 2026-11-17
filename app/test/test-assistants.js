/**
 * Tests Assistants enregistrés — création réelle, pause, suppression, isolation.
 */
'use strict';
const assert = require('assert');
const assistants = require('../server/assistants');

(() => {
  let n = 0; const ok = (name) => { n++; console.log(`✅ ${name}`); };
  const WS = 'test-ast-' + Date.now().toString(36);

  const a = assistants.create({ workspaceId: WS, name: 'Boutique Test — WhatsApp', channel: 'whatsapp', mission: 'Vendre vos produits', businessName: 'Boutique Test', instructions: 'Tu es poli.' });
  assert(a.id && a.active === true);
  ok('Assistant : création enregistrée');

  assert.strictEqual(assistants.list(WS).length, 1);
  assert.strictEqual(assistants.list('autre-' + WS).length, 0);
  ok('Assistant : chaque entreprise ne voit que les siens');

  const paused = assistants.update(WS, a.id, { active: false });
  assert.strictEqual(paused.active, false);
  assert.strictEqual(assistants.getForChat(WS, 'whatsapp'), null);
  ok('Assistant : pause = il ne répond plus');

  assert.throws(() => assistants.create({ workspaceId: WS, name: 'X', channel: 'snapchat' }), /Réseau inconnu/);
  ok('Assistant : réseau inconnu refusé');

  assert.strictEqual(assistants.update('autre-' + WS, a.id, { active: true }), null);
  assert.strictEqual(assistants.remove(WS, a.id), true);
  assert.strictEqual(assistants.list(WS).length, 0);
  ok('Assistant : suppression réelle, impossible depuis un autre espace');

  console.log(`\n🎉 Assistants enregistrés : ${n}/${n} tests réussis`);
})();
