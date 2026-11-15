/**
 * Crédits — 1 message généré par l'IA = 1 crédit.
 * Règles : jamais de solde négatif, débit atomique (vérif + retrait en une opération),
 * messages humains = 0 crédit, Playground = 0 crédit.
 * En production, cette logique devient une fonction PostgreSQL transactionnelle (Supabase).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'credits.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { demo: { balance: 340, max: 500, plan: 'starter', transactions: [] } }; }
}
function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8');
}

let db = load();

function account(workspaceId = 'demo') {
  if (!db[workspaceId]) { db[workspaceId] = { balance: 0, max: 0, plan: 'starter', transactions: [] }; save(db); }
  return db[workspaceId];
}

/** Tente de débiter 1 crédit. Retourne false si solde insuffisant (aucun débit). */
function consume(workspaceId = 'demo', reason = 'message_ia') {
  const acc = account(workspaceId);
  if (acc.balance <= 0) return false;
  acc.balance -= 1;
  acc.transactions.unshift({ at: new Date().toISOString(), amount: -1, reason });
  acc.transactions = acc.transactions.slice(0, 100);
  save(db);
  return true;
}

function grant(workspaceId = 'demo', amount, reason = 'achat') {
  const acc = account(workspaceId);
  acc.balance += amount;
  acc.transactions.unshift({ at: new Date().toISOString(), amount, reason });
  save(db);
  return acc.balance;
}

function get(workspaceId = 'demo') {
  const acc = account(workspaceId);
  return { balance: acc.balance, max: acc.max, plan: acc.plan, transactions: acc.transactions.slice(0, 20) };
}

function setPlan(workspaceId = 'demo', plan, max) {
  const acc = account(workspaceId);
  if (plan) acc.plan = plan;
  if (max !== undefined) acc.max = max;
  save(db); return acc;
}
/** Ajustement manuel par l'admin (+ ou -). Le solde ne descend jamais sous 0. */
function adjust(workspaceId = 'demo', amount, reason = 'ajustement_admin') {
  const acc = account(workspaceId);
  const delta = parseInt(amount, 10);
  if (!Number.isFinite(delta) || delta === 0) return { error: 'Montant invalide' };
  acc.balance = Math.max(0, acc.balance + delta);
  acc.transactions.unshift({ at: new Date().toISOString(), amount: delta, reason });
  acc.transactions = acc.transactions.slice(0, 100);
  save(db);
  return { balance: acc.balance };
}

module.exports = { consume, grant, get, setPlan, adjust };
