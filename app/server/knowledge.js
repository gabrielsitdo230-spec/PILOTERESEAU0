/**
 * Base de connaissances — stockage + recherche de pertinence.
 * v1 : recherche par mots-clés pondérés (fonctionne sans service externe,
 *      rapide sur petits volumes, idéal pour démarrer).
 * v1.1 (prévu) : embeddings pgvector dans Supabase — même interface `search()`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'knowledge.json');
const SEED_FILE = path.join(DATA_DIR, 'knowledge.seed.json');

function load() {
  try {
    if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (fs.existsSync(SEED_FILE)) return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  } catch (e) { console.error('[knowledge] lecture impossible:', e.message); }
  return [];
}
function save(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(items, null, 2), 'utf8');
}

let items = load();

const STOPWORDS = new Set(['le','la','les','de','des','du','un','une','et','est','je','vous','tu','il','elle','nous','pour','dans','sur','avec','pas','que','qui','au','aux','ce','cette','mon','ma','mes','votre','vos','être','avoir','faire','plus','sont','chez','moi','toi','lui','oui','non','si','se','en','par','à','a']);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/** découpe un long texte en morceaux recherchables (~500 caractères). */
function chunk(text, size = 500) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out.length ? out : [''];
}

/** Retourne les extraits les plus pertinents pour la question. */
function search(query, { workspaceId = 'demo', limit = 3 } = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const scored = [];
  for (const item of items) {
    if (item.workspaceId !== workspaceId) continue;
    for (const piece of chunk(item.content)) {
      const pTokens = tokenize(piece);
      if (!pTokens.length) continue;
      const freq = new Map();
      pTokens.forEach(t => freq.set(t, (freq.get(t) || 0) + 1));
      let score = 0;
      for (const qt of qTokens) {
        if (freq.has(qt)) score += 1 + Math.log(1 + freq.get(qt));
        // correspondance partielle (ex. "livrez" ~ "livraison")
        for (const [t, f] of freq) {
          if (t !== qt && (t.startsWith(qt.slice(0, 5)) || qt.startsWith(t.slice(0, 5)))) score += 0.35;
        }
      }
      // bonus si le titre correspond
      const titleTokens = tokenize(item.title);
      for (const qt of qTokens) if (titleTokens.includes(qt)) score += 2;
      if (score > 0.8) scored.push({ title: item.title, content: piece, score: Math.round(score * 100) / 100 });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function add({ workspaceId = 'demo', type = 'text', title, content }) {
  const item = {
    id: 'kb_' + Date.now().toString(36),
    workspaceId, type,
    title: (title || 'Sans titre').slice(0, 120),
    content: (content || '').slice(0, 20000),
    createdAt: new Date().toISOString(),
  };
  items.push(item); save(items);
  return item;
}
function list(workspaceId = 'demo') {
  return items.filter(i => i.workspaceId === workspaceId)
    .map(({ id, type, title, createdAt }) => ({ id, type, title, createdAt, statut: 'Prêt' }));
}
function remove(id) {
  const before = items.length;
  items = items.filter(i => i.id !== id); save(items);
  return items.length < before;
}

module.exports = { search, add, list, remove, tokenize };
