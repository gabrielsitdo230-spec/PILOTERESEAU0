/**
 * PILOTE RÉSEAU — Transfert des données JSON actuelles vers Cloudflare D1.
 * Usage : node cloudflare/tools/migrate-json-to-d1.js
 * Produit : cloudflare/private-data/0002_data.sql  (DONNÉES PRIVÉES —
 *           ne jamais commiter : dossier ignoré par .gitignore)
 * Puis sur Cloudflare : coller le contenu (un bloc à la fois si la
 * console refuse les multi-requêtes) OU `wrangler d1 execute --file`.
 * Aucune donnée source n'est modifiée ni supprimée.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'app', 'data');
const OUT_DIR = path.join(__dirname, '..', 'private-data');
const read = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return fb; } };
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const lines = [];
const report = {};
const add = (sql) => lines.push(sql);
const count = (k, n = 1) => { report[k] = (report[k] || 0) + n; };

// ---------- Utilisateurs -> profiles + workspaces ----------
const usersDb = read('users.json', { users: [] });
const userList = Array.isArray(usersDb.users) ? usersDb.users : Object.values(usersDb.users || {});
const workspaceOwner = new Map();
for (const u of userList) {
  add(`INSERT OR IGNORE INTO profiles(id, full_name, login, auth_salt, auth_hash, created_at) VALUES (${q(u.id)}, ${q(u.name)}, ${q(u.login)}, ${q(u.salt)}, ${q(u.passwordHash)}, ${q(u.createdAt)});`);
  count('profiles');
  if (u.workspaceId && !workspaceOwner.has(u.workspaceId)) {
    workspaceOwner.set(u.workspaceId, u.id);
    add(`INSERT OR IGNORE INTO workspaces(id, owner_id, name, created_at) VALUES (${q(u.workspaceId)}, ${q(u.id)}, ${q(u.name)}, ${q(u.createdAt)});`);
    count('workspaces');
  }
}
const knownWs = new Set(workspaceOwner.keys());

// ---------- Assistants ----------
for (const a of read('assistants.json', [])) {
  if (!knownWs.has(a.workspaceId)) { count('assistants_ignores_sans_espace'); continue; }
  add(`INSERT OR IGNORE INTO assistants(id, workspace_id, name, channel, mission, instructions, is_active, created_at, updated_at) VALUES (${q(a.id)}, ${q(a.workspaceId)}, ${q(a.name)}, ${q(a.channel)}, ${q(a.mission)}, ${q(a.instructions || '')}, ${a.active === false ? 0 : 1}, ${q(a.createdAt)}, ${q(a.createdAt)});`);
  count('assistants');
}

// ---------- Base de connaissances ----------
for (const k of read('knowledge.json', [])) {
  if (!knownWs.has(k.workspaceId)) { count('savoirs_ignores_sans_espace'); continue; }
  const type = String(k.type || 'text').toLowerCase() === 'pdf' ? 'pdf' : 'text';
  add(`INSERT OR IGNORE INTO knowledge_sources(id, workspace_id, type, title, content, created_at) VALUES (${q(k.id)}, ${q(k.workspaceId)}, ${q(type)}, ${q(k.title)}, ${q(k.content)}, ${q(k.createdAt)});`);
  count('knowledge_sources');
}

// ---------- Crédits ----------
const creditsDb = read('credits.json', {});
for (const [ws, acc] of Object.entries(creditsDb)) {
  if (!knownWs.has(ws)) { count('credits_ignores_sans_espace'); continue; }
  add(`INSERT OR IGNORE INTO credit_accounts(workspace_id, balance, plan) VALUES (${q(ws)}, ${q(Math.max(0, acc.balance | 0))}, ${q(acc.plan || 'starter')});`);
  count('credit_accounts');
  (acc.transactions || []).forEach((t, i) => {
    add(`INSERT OR IGNORE INTO credit_transactions(id, workspace_id, amount, type, created_at) VALUES (${q('ctx_' + ws + '_' + i + '_' + String(t.at || '').replace(/[^0-9]/g, ''))}, ${q(ws)}, ${q(t.amount | 0)}, ${q(t.reason || t.type || 'mouvement')}, ${q(t.at)});`);
    count('credit_transactions');
  });
}

// ---------- Paiements ----------
const statusMap = { success: 'paid', paid: 'paid', pending: 'pending', cancelled: 'cancelled', canceled: 'cancelled', failed: 'failed' };
for (const p of read('payments.json', [])) {
  if (!knownWs.has(p.workspaceId)) { count('paiements_ignores_sans_espace'); continue; }
  add(`INSERT OR IGNORE INTO payments(id, workspace_id, provider, provider_ref, amount, currency, amount_usd, method, country, status, credits_granted, created_at) VALUES (${q(p.id)}, ${q(p.workspaceId)}, ${q(p.provider || 'saspay')}, ${q(p.providerRef)}, ${q(p.chargedAmount || p.amount || 0)}, ${q(p.chargedCurrency || p.currency || 'USD')}, ${q(p.amount || null)}, ${q(p.method)}, ${q(p.country)}, ${q(statusMap[p.status] || 'pending')}, ${q(p.creditsGranted | 0)}, ${q(p.createdAt)});`);
  count('payments');
}

// ---------- Comptes sociaux connectés ----------
const store = read('store.json', { accounts: [], messages: [] });
for (const a of store.accounts || []) {
  if (!knownWs.has(a.workspaceId)) { count('comptes_sociaux_ignores'); continue; }
  add(`INSERT OR IGNORE INTO connected_accounts(id, workspace_id, channel, external_id, display_name, access_token_encrypted, status, created_at) VALUES (${q(a.id)}, ${q(a.workspaceId)}, ${q(a.channel)}, ${q(a.externalId)}, ${q(a.displayName)}, ${q(a.tokenEncrypted || '')}, 'connected', ${q(a.createdAt || new Date().toISOString())});`);
  count('connected_accounts');
}
// Messages historiques : rattachés à une conversation synthétique par contact.
const convByKey = new Map();
for (const m of store.messages || []) {
  if (!knownWs.has(m.workspaceId)) { count('messages_ignores_demo'); continue; }
  const key = m.workspaceId + '|' + m.channel + '|' + (m.from || 'inconnu');
  if (!convByKey.has(key)) {
    convByKey.set(key, 'conv_' + Math.abs([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36));
    add(`INSERT OR IGNORE INTO conversations(id, workspace_id, channel, contact_external_id, contact_name, last_message_at, created_at) VALUES (${q(convByKey.get(key))}, ${q(m.workspaceId)}, ${q(m.channel)}, ${q(m.from || 'inconnu')}, ${q(m.contactName)}, ${q(m.createdAt)}, ${q(m.createdAt)});`);
    count('conversations');
  }
  add(`INSERT OR IGNORE INTO messages(id, conversation_id, direction, sender, content, external_message_id, created_at) VALUES (${q(m.id)}, ${q(convByKey.get(key))}, ${q(m.direction || 'in')}, ${q(m.sender === 'ai' ? 'ai' : m.direction === 'in' ? 'contact' : 'ai')}, ${q(m.text || m.content || '')}, ${q(m.externalId)}, ${q(m.createdAt)});`);
  count('messages');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, '0002_data.sql');
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log('✅ Fichier de transfert généré :', out);
console.log('📊 Contenu :', JSON.stringify(report, null, 1));
console.log('🔒 Ce fichier contient des données réelles : il reste LOCAL (ignoré par git).');
