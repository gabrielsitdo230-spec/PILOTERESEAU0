/**
 * Tests Étape 5 + Admin — lancer : node test/test-payments-admin.js
 * Prix modifiables manuellement, paiement idempotent, ajustement crédits admin.
 */
'use strict';
const assert = require('assert');
const plans = require('../server/plans');
const payments = require('../server/payments');
const credits = require('../server/credits');

let n = 0; const ok = (name) => { n++; console.log(`✅ ${name}`); };

(async () => {

// 1. Prix par défaut présents
const def = plans.get('pro');
assert(def && def.priceMonthly === 10 && def.creditsIncluded === 3500);
ok('Plans : Starter / Pro / Business disponibles');

// 2. MODIFICATION MANUELLE DU PRIX par l'admin
const before = credits.get('demo').balance;
const upd = plans.update('pro', { priceMonthly: 12, currency: 'USD', creditsIncluded: 4000 });
assert(!upd.error, upd.error);
assert.strictEqual(plans.get('pro').priceMonthly, 12);
assert.strictEqual(plans.get('pro').creditsIncluded, 4000);
ok('Admin : prix du plan Pro modifié manuellement (10 -> 12)');

// 3. Prix invalide refusé proprement
assert(plans.update('pro', { priceMonthly: -5 }).error);
assert(plans.update('pro', { currency: '$$' }).error);
assert.strictEqual(plans.get('pro').priceMonthly, 12);
ok('Admin : prix invalides refusés, plan intact');

// 4. Création + masquage + suppression d'un plan
const created = plans.create({ code: 'test-premium', name: 'Test Premium', priceMonthly: 39, creditsIncluded: 5000, maxAssistants: 5 });
assert(created.plan && created.plan.code === 'test-premium');
plans.update('test-premium', { active: false });
assert(!plans.list({ onlyActive: true }).find(p => p.code === 'test-premium'));
assert(plans.list().find(p => p.code === 'test-premium'));
plans.remove('test-premium');
ok('Admin : créer / masquer / supprimer un plan');

// 5. Checkout -> paiement pending au NOUVEAU prix
const co = await payments.checkout({ planCode: 'pro', method: 'orange_money', phone: '+243815000000' });
assert(!co.error, co.error);
assert.strictEqual(co.payment.status, 'pending');
assert.strictEqual(co.payment.amount, 12);
ok('Paiement : commande créée au prix défini par l\'admin');

// 6. Confirmation -> crédits ajoutés (3000), une seule fois (idempotent)
const c1 = payments.confirm(co.payment.providerRef, { status: 'success' });
assert.strictEqual(c1.payment.creditsGranted, 4000);
const afterFirst = credits.get('demo').balance;
const c2 = payments.confirm(co.payment.providerRef, { status: 'success' });
assert.strictEqual(c2.alreadyProcessed, true);
assert.strictEqual(credits.get('demo').balance, afterFirst); // aucun double crédit
ok('Paiement : confirmation idempotente — crédits ajoutés une seule fois');

// 7. Ajustement manuel de crédits par l'admin (solde jamais négatif)
const adj = credits.adjust('demo', 100, 'test_admin');
assert.strictEqual(adj.balance, afterFirst + 100);
const adj2 = credits.adjust('demo', -999999, 'test_admin');
assert.strictEqual(adj2.balance, 0);
credits.adjust('demo', before, 'test-restauration'); // on remet le solde de démo initial (balance était à before après ajustements? on force ci-dessous)
ok('Admin : donner/retirer des crédits, solde jamais négatif');

// 8. On remet prix et solde de démo propres pour l'utilisateur
plans.update('pro', { priceMonthly: 10, creditsIncluded: 3500 });
credits.adjust('demo', 340 - credits.get('demo').balance, 'restauration_demo');
assert.strictEqual(credits.get('demo').balance, 340);
assert.strictEqual(plans.get('pro').priceMonthly, 10);
ok('Démo restaurée : Pro = 10 USD, solde = 340 crédits');

console.log(`\n🎉 ${n}/8 tests réussis — Étape 5 + Admin OK`);
})().catch(e => { console.error('❌ Test en échec :', e.message); process.exit(1); });
