/**
 * Assistants des clients — un assistant par réseau, enregistré par entreprise.
 * Champs simples : nom, réseau, mission, instructions, actif (pause).
 * Le statut "connecté" n'est PAS stocké ici : il vient des vrais comptes
 * liés (server/store.js, via Meta/TikTok) pour ne jamais afficher un faux "connecté".
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'assistants.json');

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function save(items) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(items, null, 2), 'utf8'); }

let items = load();
const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'tiktok'];

function pub(a) {
  return { id: a.id, name: a.name, channel: a.channel, mission: a.mission, businessName: a.businessName || '', active: a.active !== false, createdAt: a.createdAt };
}
function list(workspaceId) { return items.filter(a => a.workspaceId === workspaceId).map(pub); }
function create({ workspaceId, name, channel, mission, businessName, instructions }) {
  if (!CHANNELS.includes(channel)) { const e = new Error('Réseau inconnu. Choisissez WhatsApp, Facebook, Instagram ou TikTok.'); e.code = 'BAD_CHANNEL'; throw e; }
  const a = {
    id: 'ast_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    workspaceId, name: String(name || 'Mon assistant').slice(0, 80), channel,
    mission: String(mission || 'Répondre aux clients').slice(0, 120),
    businessName: String(businessName || '').slice(0, 80),
    instructions: String(instructions || '').slice(0, 4000),
    active: true, createdAt: new Date().toISOString(),
  };
  items.push(a); save(items);
  return pub(a);
}
function update(workspaceId, id, patch = {}) {
  const a = items.find(x => x.id === id && x.workspaceId === workspaceId);
  if (!a) return null;
  if (typeof patch.active === 'boolean') a.active = patch.active;
  if (patch.name) a.name = String(patch.name).slice(0, 80);
  save(items);
  return pub(a);
}
function remove(workspaceId, id) {
  const before = items.length;
  items = items.filter(a => !(a.id === id && a.workspaceId === workspaceId));
  if (items.length < before) { save(items); return true; }
  return false;
}
function getForChat(workspaceId, channel) {
  const a = items.find(x => x.workspaceId === workspaceId && (!channel || x.channel === channel) && x.active !== false);
  return a || null;
}

module.exports = { list, create, update, remove, getForChat, CHANNELS };
