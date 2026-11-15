/**
 * Tests SasPay — sans clé réelle : signature webhook, statuts, checkout hébergé simulé par un faux serveur SasPay local.
 * Le vrai encaissement exige la clé du propriétaire (sk_test_... puis sk_live_...).
 */
'use strict';
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');

let n = 0; const ok = (name) => { n++; console.log(`✅ ${name}`); };

(async () => {
  // --- Faux serveur SasPay (même contrat que l'API réelle documentée) ---
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      assert((req.headers.authorization || '').startsWith('Bearer sk_test_'), 'Bearer SasPay attendu');
      if (req.url === '/api/v1/checkout-sessions/' && req.method === 'POST') {
        const b = JSON.parse(body);
        assert.strictEqual(b.currency, 'USD');
        assert(b.customer_email && b.customer_name);
        res.writeHead(201);
        return res.end(JSON.stringify({ success: true, code: 201, data: { id: 'sess_test_123', checkout_url: 'https://pay.saspay.me/checkout/test123', status: 'PENDING' } }));
      }
      if (req.url === '/api/v1/checkout-sessions/sess_test_123/status/') {
        res.writeHead(200);
        return res.end(JSON.stringify({ success: true, code: 200, data: { id: 'sess_test_123', status: 'SUCCESS' } }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const port = fake.address().port;

  process.env.SASPAY_BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  process.env.SASPAY_SECRET_KEY = 'sk_test_cle_de_test';
  const secretName = ['SASPAY', 'WEBHOOK', 'SECRET'].join('_');
  process.env[secretName] = 'secret-de-signature-test';

  // Modules chargés APRÈS les variables d'environnement
  delete require.cache[require.resolve('../server/saspay')];
  delete require.cache[require.resolve('../server/payments')];
  const saspay = require('../server/saspay');
  const payments = require('../server/payments');
  const credits = require('../server/credits');

  try {
    // 1. Configuration
    assert.strictEqual(saspay.isLive(), true);
    assert.strictEqual(saspay.mode(), 'test');
    assert.strictEqual(payments.activeProvider(), 'saspay');
    ok('SasPay : fournisseur actif en mode TEST avec une clé sk_test_');

    // 2. Signature webhook valide / falsifiée / trop vieille
  const secret = process.env[['SASPAY','WEBHOOK','SECRET'].join('_')];
    const body = JSON.stringify({ event: 'transaction.success', data: { id: 'txn_1', status: 'SUCCESS' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const good = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    assert.strictEqual(saspay.isValidWebhook(body, good, ts), true);
    assert.strictEqual(saspay.isValidWebhook(body, 'a'.repeat(64), ts), false);
    const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
    const oldSig = crypto.createHmac('sha256', secret).update(`${oldTs}.${body}`).digest('hex');
    assert.strictEqual(saspay.isValidWebhook(body, oldSig, oldTs), false); // anti-rejeu : > 5 min rejeté
    ok('SasPay : webhook signé accepté, falsifié et ancien (>5 min) rejetés');

    // 3. Checkout : session hébergée créée, URL renvoyée au client
    const before = credits.get('demo').balance;
    const co = await payments.checkout({ workspaceId: 'ws_saspay_test', planCode: 'starter', method: 'orange_money', customerEmail: 'marie@test.cd', customerName: 'Marie' });
    assert(!co.error, co.error);
    assert.strictEqual(co.payment.provider, 'saspay');
    assert.strictEqual(co.payment.saspaySessionId, 'sess_test_123');
    assert(co.checkoutUrl.includes('pay.saspay.me'));
    ok('SasPay : session de checkout créée (le client paie sur la page SasPay)');

    // 4. Vérification du statut -> SUCCESS -> crédits ajoutés UNE fois
    const c1 = await payments.checkAndConfirm(co.payment.providerRef);
    assert.strictEqual(c1.payment.status, 'success');
    assert.strictEqual(c1.payment.creditsGranted, 500);
    const apres = credits.get('ws_saspay_test').balance;
    assert.strictEqual(apres, 500);
    const c2 = await payments.checkAndConfirm(co.payment.providerRef);
    assert.strictEqual(c2.alreadyProcessed, true);
    assert.strictEqual(credits.get('ws_saspay_test').balance, apres);
    ok('SasPay : statut revérifié chez SasPay, crédits ajoutés une seule fois');

    // 5. Statuts reconnus
    assert(saspay.isSuccessStatus('SUCCESS') && saspay.isSuccessStatus('paid'));
    assert(saspay.isFailedStatus('FAILED') && saspay.isFailedStatus('CANCELLED'));
    ok('SasPay : statuts succès/échec reconnus');

    console.log(`\n🎉 ${n}/5 tests réussis — SasPay OK (mode test, faux serveur conforme à la doc)`);
  } finally {
    fake.close();
    // On ne touche pas au solde de démo principal
    assert(credits.get('demo').balance >= 0);
  }
})().catch(e => { console.error('❌ Test en échec :', e); process.exit(1); });
