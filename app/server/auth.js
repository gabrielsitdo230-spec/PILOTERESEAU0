/**
 * Comptes clients RÉELS (chantier 9).
 * - Inscription / connexion / session par jeton (Bearer).
 * - Mots de passe : jamais en clair — scrypt + sel unique par utilisateur.
 * - Jetons de session : stockés hachés (SHA-256), révocables (déconnexion).
 * - Chaque compte = 1 workspace isolé (crédits, connaissances, comptes connectés).
 * Production cible : Supabase Auth (même modèle). Ce module est l'adaptateur local,
 * remplaçable sans changer les routes ni l'interface.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'users.json');

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { users: [], sessions: [] }; } }
function save(db) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8'); }
let db = load();

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function newSalt() { return crypto.randomBytes(16).toString('hex'); }
function tokenHash(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function normalizeLogin(login) { return String(login || '').trim().toLowerCase(); }

function publicUser(u) {
  return { id: u.id, name: u.name, login: u.login, workspaceId: u.workspaceId, createdAt: u.createdAt };
}

function findByLogin(login) {
  const l = normalizeLogin(login);
  return db.users.find(u => u.login === l) || null;
}

/** Inscription. Retourne { user, token } ou { error }. */
function register({ name, login, motdepasse }) {
  const l = normalizeLogin(login);
  if (!name || !String(name).trim()) return { error: 'Dites-nous votre nom ou le nom de votre boutique.' };
  if (!l || l.length < 3) return { error: 'Indiquez un numéro de téléphone ou un email valide.' };
  if (!motdepasse || String(motdepasse).length < 6) return { error: 'Mot de passe trop court : 6 caractères minimum.' };
  if (findByLogin(l)) return { error: 'Un compte existe déjà avec ce numéro/email. Essayez de vous connecter.' };
  const salt = newSalt();
  const user = {
    id: 'usr_' + crypto.randomBytes(6).toString('hex'),
    workspaceId: 'ws_' + crypto.randomBytes(6).toString('hex'),
    name: String(name).trim().slice(0, 80),
    login: l,
    salt,
    passwordHash: hashPassword(motdepasse, salt),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user); save(db);
  return { user: publicUser(user), token: createSession(user) };
}

function verifyPassword(user, motdepasse) {
  const candidate = Buffer.from(hashPassword(motdepasse, user.salt), 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function login({ login, motdepasse }) {
  const user = findByLogin(login);
  // Même message dans les deux cas : ne jamais révéler si le compte existe.
  if (!user || !verifyPassword(user, motdepasse || '')) {
    return { error: 'Numéro/email ou mot de passe incorrect. Vérifiez et réessayez.' };
  }
  return { user: publicUser(user), token: createSession(user) };
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({
    tokenHash: tokenHash(token),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), // 30 jours
  });
  db.sessions = db.sessions.slice(-500);
  save(db);
  return token;
}

/** Résout un jeton Bearer -> utilisateur public (ou null). */
function resolveToken(token) {
  if (!token) return null;
  const h = tokenHash(token);
  const session = db.sessions.find(s => s.tokenHash === h);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.sessions = db.sessions.filter(s => s.tokenHash !== h); save(db);
    return null;
  }
  const user = db.users.find(u => u.id === session.userId);
  return user ? publicUser(user) : null;
}

function logout(token) {
  if (!token) return false;
  const h = tokenHash(token);
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.tokenHash !== h);
  if (db.sessions.length !== before) { save(db); return true; }
  return false;
}

function count() { return db.users.length; }

module.exports = { register, login, logout, resolveToken, publicUser, count };
