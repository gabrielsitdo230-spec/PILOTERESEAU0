/**
 * Données plateforme pour la page ADMIN (super-admin).
 * v1 locale : workspace de démo + exemples. Production : tables Supabase (service_role, serveur only).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'platform.json');

const SEED = {
  workspaces: [
    { id: 'demo', name: 'Boutique Amina', owner: 'Amina', phone: '+243 815 000 000', country: 'CD', plan: 'starter', status: 'active', assistantsPaused: false, createdAt: '2026-11-10T08:00:00.000Z' },
    { id: 'ws_salon', name: 'Salon Beauté Divine', owner: 'Divine M.', phone: '+243 997 111 222', country: 'CD', plan: 'pro', status: 'active', assistantsPaused: false, createdAt: '2026-11-11T09:30:00.000Z' },
    { id: 'ws_resto', name: 'Restaurant Le Baobab', owner: 'Jean K.', phone: '+243 810 333 444', country: 'CD', plan: 'starter', status: 'active', assistantsPaused: true, createdAt: '2026-11-12T14:00:00.000Z' },
    { id: 'ws_shop', name: 'Kin Shop Express', owner: 'Sarah L.', phone: '+243 895 555 666', country: 'CD', plan: 'business', status: 'suspended', assistantsPaused: false, createdAt: '2026-11-13T10:15:00.000Z' },
  ],
};

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { save(SEED); return structuredClone(SEED); } }
function save(db) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8'); }
let db = load();

function listWorkspaces() { return db.workspaces.slice(); }
function getWorkspace(id) { return db.workspaces.find(w => w.id === id) || null; }
function updateWorkspace(id, patch = {}) {
  const ws = getWorkspace(id);
  if (!ws) return { error: 'Client introuvable' };
  if (patch.status && ['active', 'suspended'].includes(patch.status)) ws.status = patch.status;
  if (patch.assistantsPaused !== undefined) ws.assistantsPaused = Boolean(patch.assistantsPaused);
  if (patch.plan) ws.plan = String(patch.plan).slice(0, 20);
  save(db);
  return { workspace: ws };
}
module.exports = { listWorkspaces, getWorkspace, updateWorkspace };
