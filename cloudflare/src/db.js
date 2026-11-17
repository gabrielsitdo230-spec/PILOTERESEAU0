/**
 * PILOTE RÉSEAU — Couche d'accès Cloudflare D1 (Étape B)
 * ------------------------------------------------------
 * Reproduit les fonctions des modules Node actuels (auth, assistants,
 * knowledge, credits, payments, store) en SQL D1, sans changer les
 * règles métier : espaces séparés par workspaceId, crédits jamais
 * négatifs (débit atomique), 1 message IA = 1 crédit.
 * Utilisée par le Worker à l'Étape C. Aucune donnée sensible ici.
 */

const id = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();

// ---------- Comptes & sessions ----------
export async function findUserByLogin(DB, login) {
  return DB.prepare('SELECT * FROM profiles WHERE login = ?').bind(login).first();
}
export async function createUser(DB, { name, login, salt, hash }) {
  const userId = id('usr_'); const wsId = id('ws_');
  await DB.batch([
    DB.prepare('INSERT INTO profiles(id, full_name, login, auth_salt, auth_hash) VALUES (?,?,?,?,?)').bind(userId, name, login, salt, hash),
    DB.prepare('INSERT INTO workspaces(id, owner_id, name) VALUES (?,?,?)').bind(wsId, userId, name),
    DB.prepare("INSERT INTO credit_accounts(workspace_id, balance, plan) VALUES (?, 10, 'starter')").bind(wsId), // commencer gratuitement (nombre non affiché côté client)
    DB.prepare("INSERT INTO credit_transactions(id, workspace_id, amount, type) VALUES (?,?,10,'bonus_bienvenue')").bind(id('ctx_'), wsId),
  ]);
  return { userId, workspaceId: wsId };
}
export async function createSession(DB, userId, tokenHash, expiresAt) {
  await DB.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?,?,?)').bind(tokenHash, userId, expiresAt).run();
}
export async function userBySession(DB, tokenHash) {
  return DB.prepare('SELECT p.*, w.id AS workspace_id FROM sessions s JOIN profiles p ON p.id = s.user_id JOIN workspaces w ON w.owner_id = p.id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(tokenHash, now()).first();
}
export async function deleteSession(DB, tokenHash) {
  await DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

// ---------- Assistants ----------
export async function listAssistants(DB, ws) {
  const r = await DB.prepare('SELECT * FROM assistants WHERE workspace_id = ? ORDER BY created_at').bind(ws).all();
  return r.results || [];
}
export async function createAssistant(DB, ws, { name, channel, mission, instructions }) {
  const a = { id: id('ast_'), workspace_id: ws, name, channel, mission: mission || 'Répondre aux clients', instructions: instructions || '', is_active: 1 };
  await DB.prepare('INSERT INTO assistants(id, workspace_id, name, channel, mission, instructions) VALUES (?,?,?,?,?,?)')
    .bind(a.id, ws, a.name, a.channel, a.mission, a.instructions).run();
  return a;
}
export async function setAssistantActive(DB, ws, assistantId, active) {
  const r = await DB.prepare('UPDATE assistants SET is_active = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .bind(active ? 1 : 0, now(), assistantId, ws).run();
  return r.meta.changes > 0;
}
export async function deleteAssistant(DB, ws, assistantId) {
  const r = await DB.prepare('DELETE FROM assistants WHERE id = ? AND workspace_id = ?').bind(assistantId, ws).run();
  return r.meta.changes > 0;
}

// ---------- Base de connaissances ----------
export async function addKnowledge(DB, ws, { type, title, content }) {
  const k = { id: id('kb_'), workspace_id: ws, type: type || 'text', title, content };
  await DB.prepare('INSERT INTO knowledge_sources(id, workspace_id, type, title, content) VALUES (?,?,?,?,?)')
    .bind(k.id, ws, k.type, title, content).run();
  return k;
}
export async function listKnowledge(DB, ws) {
  const r = await DB.prepare('SELECT id, type, title, length(content) AS caracteres, created_at FROM knowledge_sources WHERE workspace_id = ? ORDER BY created_at').bind(ws).all();
  return r.results || [];
}
export async function deleteKnowledge(DB, ws, knowledgeId) {
  const r = await DB.prepare('DELETE FROM knowledge_sources WHERE id = ? AND workspace_id = ?').bind(knowledgeId, ws).run();
  return r.meta.changes > 0;
}
export async function allKnowledge(DB, ws) {
  const r = await DB.prepare('SELECT title, content FROM knowledge_sources WHERE workspace_id = ?').bind(ws).all();
  return r.results || [];
}

// ---------- Crédits (débit atomique, jamais négatif) ----------
export async function getCredits(DB, ws) {
  const acc = await DB.prepare('SELECT * FROM credit_accounts WHERE workspace_id = ?').bind(ws).first();
  const tx = await DB.prepare('SELECT * FROM credit_transactions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20').bind(ws).all();
  return { balance: acc ? acc.balance : 0, plan: acc ? acc.plan : 'starter', transactions: tx.results || [] };
}
export async function consumeCredit(DB, ws, reason = 'message_ia') {
  const r = await DB.prepare('UPDATE credit_accounts SET balance = balance - 1 WHERE workspace_id = ? AND balance > 0').bind(ws).run();
  if (r.meta.changes === 0) return false;
  await DB.prepare('INSERT INTO credit_transactions(id, workspace_id, amount, type) VALUES (?,?,?,?)').bind(id('ctx_'), ws, -1, reason).run();
  return true;
}
export async function grantCredits(DB, ws, amount, reason = 'achat') {
  await DB.batch([
    DB.prepare('INSERT INTO credit_accounts(workspace_id, balance) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET balance = balance + excluded.balance').bind(ws, amount),
    DB.prepare('INSERT INTO credit_transactions(id, workspace_id, amount, type) VALUES (?,?,?,?)').bind(id('ctx_'), ws, amount, reason),
  ]);
}

// ---------- Paiements ----------
export async function createPayment(DB, ws, p) {
  const pay = { id: id('pay_'), workspace_id: ws, status: 'pending', ...p };
  await DB.prepare('INSERT INTO payments(id, workspace_id, provider, provider_ref, amount, currency, amount_usd, method, country, status) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(pay.id, ws, pay.provider, pay.provider_ref || null, pay.chargedAmount || pay.amount, pay.currency, pay.amount_usd || null, pay.method || null, pay.country || null, 'pending').run();
  return pay;
}
export async function paymentByRef(DB, ref) {
  return DB.prepare('SELECT * FROM payments WHERE provider_ref = ?').bind(ref).first();
}
export async function setPaymentStatus(DB, ref, status, creditsGranted = 0) {
  const r = await DB.prepare('UPDATE payments SET status = ?, credits_granted = ? WHERE provider_ref = ?').bind(status, creditsGranted, ref).run();
  return r.meta.changes > 0;
}

// ---------- Comptes sociaux & messages ----------
export async function listConnectedAccounts(DB, ws) {
  const r = await DB.prepare('SELECT id, channel, external_id, display_name, status FROM connected_accounts WHERE workspace_id = ?').bind(ws).all();
  return r.results || [];
}
export async function listRecentMessages(DB, ws, limit = 100) {
  const r = await DB.prepare(`SELECT m.*, c.channel, c.contact_name FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.workspace_id = ? ORDER BY m.created_at DESC LIMIT ?`).bind(ws, limit).all();
  return r.results || [];
}
export async function logOperation(DB, ws, actor, action, detail) {
  await DB.prepare('INSERT INTO operation_log(id, workspace_id, actor, action, detail) VALUES (?,?,?,?,?)')
    .bind(id('log_'), ws, actor, action, detail).run();
}
