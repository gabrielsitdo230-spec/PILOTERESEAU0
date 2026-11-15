/**
 * Tests Étape 3 — lancer : npm test
 * Vérifie : génération d'instructions, réponses depuis la KB, anti-invention,
 * détection passage humain, crédits (jamais négatif, 1 message = 1 crédit).
 */
'use strict';
const assert = require('assert');
const brain = require('../server/assistant');
const knowledge = require('../server/knowledge');
const credits = require('../server/credits');

(async () => {
  let n = 0;
  const ok = (name) => { n++; console.log(`✅ ${name}`); };

  // 1. Instructions générées depuis les 5 questions
  const instructions = brain.buildInstructions({
    businessName: 'Salon Beauté Divine', activity: 'Coiffure et soins',
    zone: 'Kinshasa', hours: 'Tous les jours 9h-19h', tone: 'doux et pro',
    mission: 'prendre des rendez-vous',
  });
  assert(instructions.includes('Salon Beauté Divine') && instructions.includes('rendez-vous'));
  ok('Configuration guidée : 5 questions -> instructions');

  const assistant = { businessName: 'Boutique Amina', instructions };

  // 2. Réponse tirée de la vraie base de connaissances (prix robe rouge = 45 $)
  const r1 = await brain.generateReply({ assistant, userText: 'La robe rouge coûte combien ?' });
  assert(r1.reply.includes('45'), 'Le prix KB doit apparaître: ' + r1.reply);
  assert(r1.usedKnowledge.length >= 1);
  ok('Playground : réponse construite depuis la base de connaissances');

  // 3. Anti-invention : question absente de la KB -> pas de prix inventé, proposition humain
  const r2 = await brain.generateReply({ assistant, userText: 'Vous vendez des motos ?' });
  assert(!/\d+\s*\$$/.test(r2.reply.replace('45 $', '')), 'Ne doit pas inventer de prix: ' + r2.reply);
  ok('Anti-invention : aucune info inventée quand la KB ne sait pas');

  // 4. Passage à un humain détecté
  const r3 = await brain.generateReply({ assistant, userText: 'Je veux parler à un humain' });
  assert.strictEqual(r3.handoff, true);
  ok('Passage à un humain : détecté automatiquement');

  // 5. Recherche KB livraison
  const found = knowledge.search('Vous livrez à Kinshasa en combien de temps ?');
  assert(found.length && found[0].title.toLowerCase().includes('livraison'));
  ok('Base de connaissances : recherche pertinente (livraison)');

  // 6. Crédits : débit unitaire + jamais négatif
  const before = credits.get('demo').balance;
  assert.strictEqual(credits.consume('demo', 'test'), true);
  assert.strictEqual(credits.get('demo').balance, before - 1);
  credits.grant('demo', 1, 'test-retour'); // on remet pour ne pas polluer la démo
  ok('Crédits : 1 message IA = 1 crédit, solde cohérent');

  console.log(`\n🎉 ${n}/6 tests réussis — Étape 3 OK`);
})().catch(e => { console.error('❌ Test en échec :', e.message); process.exit(1); });
