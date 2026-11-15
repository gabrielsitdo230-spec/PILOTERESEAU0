/**
 * Tests — Page Admin STRICTEMENT privée (propriétaire uniquement).
 * Démarre un serveur de test sur le port 3457 et vérifie par HTTP réel :
 * fichier admin introuvable, panel protégé, session cookie, déconnexion.
 */
'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
let n = 0; const ok = (name) => { n++; console.log(`✅ ${name}`); };

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch { /* pas encore */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Serveur de test introuvable');
}

(async () => {
  const srv = spawn('node', ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), ADMIN_KEY: 'code-proprietaire-test' },
    stdio: 'ignore',
  });
  try {
    await waitServer();

    // 1. Le fichier admin n'existe plus en public
    let r = await fetch(BASE + '/admin.html');
    assert.strictEqual(r.status, 404);
    r = await fetch(BASE + '/private/admin.html');
    assert.strictEqual(r.status, 404);
    ok('Admin : aucun fichier accessible directement (/admin.html = 404)');

    // 2. /admin affiche seulement l'écran de code (aucune donnée)
    r = await fetch(BASE + '/admin');
    const loginHtml = await r.text();
    assert.strictEqual(r.status, 200);
    assert(loginHtml.includes('Accès propriétaire'));
    assert(!loginHtml.includes('Vue d\'ensemble') && !loginHtml.includes('Revenus'));
    ok('Admin : /admin = écran de code uniquement, zéro donnée visible');

    // 3. Le panel refuse sans session (redirection vers /admin)
    r = await fetch(BASE + '/admin/panel', { redirect: 'manual' });
    assert.strictEqual(r.status, 302);
    assert((r.headers.get('location') || '').includes('/admin'));
    ok('Admin : /admin/panel bloqué sans session propriétaire');

    // 4. Mauvais code refusé, bon code = cookie HttpOnly
    r = await fetch(BASE + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'mauvais-code' }) });
    assert.strictEqual(r.status, 401);
    r = await fetch(BASE + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'code-proprietaire-test' }) });
    assert.strictEqual(r.status, 200);
    const cookie = r.headers.get('set-cookie') || '';
    assert(cookie.includes('pr_admin=') && cookie.includes('HttpOnly'));
    ok('Admin : mauvais code refusé, bon code = session HttpOnly');

    // 5. Avec la session : panel + API admin accessibles
    const sessionCookie = cookie.split(';')[0];
    r = await fetch(BASE + '/admin/panel', { headers: { Cookie: sessionCookie } });
    assert.strictEqual(r.status, 200);
    assert((await r.text()).includes('Prix'));
    r = await fetch(BASE + '/api/admin/overview', { headers: { Cookie: sessionCookie } });
    assert.strictEqual(r.status, 200);
    ok('Admin : propriétaire connecté -> panel et données accessibles');

    // 6. Déconnexion : la session ne vaut plus rien
    r = await fetch(BASE + '/api/admin/logout', { method: 'POST', headers: { Cookie: sessionCookie } });
    assert.strictEqual(r.status, 200);
    r = await fetch(BASE + '/api/admin/overview', { headers: { Cookie: sessionCookie } });
    assert.strictEqual(r.status, 401);
    ok('Admin : déconnexion = session révoquée immédiatement');

    console.log(`\n🎉 ${n}/6 tests réussis — Admin 100% privé OK`);
  } finally {
    srv.kill('SIGTERM');
  }
})().catch(e => { console.error('❌ Test en échec :', e.message); process.exit(1); });
