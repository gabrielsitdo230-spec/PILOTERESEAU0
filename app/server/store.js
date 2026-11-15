/**
 * Stockage Étape 4 (démo locale, fichier JSON).
 * En production : remplacé par Supabase (voir supabase/schema.sql livré avec cette étape).
 * Comptes connectés : jetons TOUJOURS chiffrés via meta-crypto.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./meta-crypto');

const FILE = path.join(__dirname, '..', 'data', 'store.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { accounts: [], conversations: [], messages: [] }; }
}
function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8');
}
let db = load();

function upsertAccount({ workspaceId = 'demo', channel, externalId, displayName, token }) {
  const existing = db.accounts.find(a => a.workspaceId === workspaceId && a.channel === channel && a.externalId === externalId);
  const rec = {
    id: existing?.id || 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    workspaceId, channel, externalId, displayName,
    tokenEncrypted: token ? encrypt(token) : existing?.tokenEncrypted || '',
    status: 'connected',
    connectedAt: existing?.connectedAt || new Date().toISOString(),
  };
  if (existing) Object.assign(existing, rec); else db.accounts.push(rec);
  save(db);
  return publicAccount(rec);
}
function publicAccount(a) {
  return { id: a.id, channel: a.channel, externalId: a.externalId, displayName: a.displayName, status: a.status, connectedAt: a.connectedAt };
}
function listAccounts(workspaceId = 'demo') { return db.accounts.filter(a => a.workspaceId === workspaceId).map(publicAccount); }
function getAccountWithToken(workspaceId, channel) {
  const a = db.accounts.find(x => x.workspaceId === workspaceId && x.channel === channel && x.status === 'connected');
  if (!a) return null;
  return { ...publicAccount(a), token: a.tokenEncrypted ? decrypt(a.tokenEncrypted) : '' };
}

function addMessage(msg) {
  const rec = { id: 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString(), ...msg };
  db.messages.push(rec); db.messages = db.messages.slice(-500); save(db);
  return rec;
}
function listMessages(limit = 50) { return db.messages.slice(-limit).reverse(); }

module.exports = { upsertAccount, listAccounts, getAccountWithToken, addMessage, listMessages };
