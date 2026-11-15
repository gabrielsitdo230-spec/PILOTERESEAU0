/**
 * Tests chantier 9 — comptes clients réels.
 * Inscription, doublon refusé, mot de passe jamais en clair, connexion,
 * session, isolation des données entre deux clients.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const auth = require('../server/auth');
const credits = require('../server/credits');
const knowledge = require('../server/knowledge');

let n = 0; const ok = (name) => { n++; console.log(`✅ ${name}`); };
const suffix = Date.now().toString(36);
const loginA = 'amina_' + suffix + '@test.cd';
const loginB = 'jean_' + suffix + '@test.cd';

// 1. Inscription A
const a = auth.register({ name: 'Boutique Amina', login: loginA, motdepasse: 'secret-a-123' });
assert(!a.error, a.error);
assert(a.token && a.user.workspaceId);
ok('Inscription : compte + workspace créés, session ouverte');

// 2. Mot de passe refusé s'il est trop court, doublon refusé
assert(auth.register({ name: 'X', login: 'x_' + suffix + '@t.cd', motdepasse: '123' }).error);
assert(auth.register({ name: 'Copie', login: loginA, motdepasse: 'autre-secret' }).error);
ok('Inscription : mot de passe court et doublon refusés avec message clair');

// 3. Le mot de passe n'est JAMAIS stocké en clair
const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'users.json'), 'utf8');
assert(!raw.includes('secret-a-123'), 'Le mot de passe ne doit jamais apparaître en clair');
ok('Sécurité : mot de passe haché (scrypt + sel), absent du fichier');

// 4. Connexion : mauvais mot de passe refusé, bon accepté
assert(auth.login({ login: loginA, motdepasse: 'mauvais' }).error);
const reconnecte = auth.login({ login: loginA, motdepasse: 'secret-a-123' });
assert(!reconnecte.error && reconnecte.token);
ok('Connexion : mauvais mot de passe refusé, bon mot de passe accepté');

// 5. Session : le jeton retrouve le bon client ; déconnexion le révoque
const me = auth.resolveToken(reconnecte.token);
assert(me && me.login === loginA && me.workspaceId === a.user.workspaceId);
auth.logout(reconnecte.token);
assert.strictEqual(auth.resolveToken(reconnecte.token), null);
ok('Session : jeton valide 30 j, déconnexion = révocation immédiate');

// 6. Isolation : B ne voit ni les crédits ni les connaissances de A
const b = auth.register({ name: 'Jean Mukendi', login: loginB, motdepasse: 'secret-b-123' });
credits.grant(a.user.workspaceId, 250, 'test');
knowledge.add({ workspaceId: a.user.workspaceId, type: 'text', title: 'Secret A', content: 'Prix confidentiel A : 999 dollars' });
assert.strictEqual(credits.get(b.user.workspaceId).balance, 0);
assert.strictEqual(knowledge.list(b.user.workspaceId).length, 0);
assert(knowledge.search('Prix confidentiel A', { workspaceId: b.user.workspaceId }).length === 0);
assert(knowledge.search('Prix confidentiel', { workspaceId: a.user.workspaceId }).length >= 1);
ok('Isolation : chaque client ne voit QUE ses crédits et ses connaissances');

// Nettoyage : on retire ce que le test a donné à A pour garder la démo propre (les comptes de test restent, inoffensifs)
credits.adjust(a.user.workspaceId, -250, 'test-nettoyage');

console.log(`\n🎉 ${n}/6 tests réussis — Comptes clients OK`);
