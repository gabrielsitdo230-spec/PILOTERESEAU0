/**
 * Plans tarifaires — MODIFIABLES MANUELLEMENT depuis la page Admin.
 * Stockés dans data/plans.json (production : table `plans` Supabase).
 * Aucun prix n'est codé en dur dans l'interface : le front lit /api/plans.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'plans.json');
const DEFAULTS = [
  { code: 'starter', name: 'Starter', priceMonthly: 2, currency: 'USD', creditsIncluded: 500, maxAssistants: 1, active: true, features: ['1 réseau au choix', '500 messages IA / mois', 'Base de connaissances', 'Boîte de réception unique'] },
  { code: 'standard', name: 'Standard', priceMonthly: 5, currency: 'USD', creditsIncluded: 1500, maxAssistants: 2, active: true, features: ['2 réseaux au choix', '1 500 messages IA / mois', 'Base de connaissances', 'Boîte de réception unique'] },
  { code: 'pro', name: 'Pro', priceMonthly: 10, currency: 'USD', creditsIncluded: 3500, maxAssistants: 3, active: true, features: ['WhatsApp + Facebook + Instagram + TikTok', '3 500 messages IA / mois', 'Connaissances illimitées', 'Statistiques avancées'] },
  { code: 'premium', name: 'Premium', priceMonthly: 25, currency: 'USD', creditsIncluded: 6000, maxAssistants: 5, active: true, features: ['Tous les réseaux', '6 000 messages IA / mois', 'Statistiques avancées', 'Support prioritaire'] },
  { code: 'business', name: 'Business', priceMonthly: 59, currency: 'USD', creditsIncluded: 10000, maxAssistants: 99, active: true, features: ['Tous les réseaux + équipe', '10 000 messages IA / mois', 'Tout le plan Premium', 'Accompagnement dédié'] },
];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch { /* première fois */ }
  save(DEFAULTS);
  return structuredClone(DEFAULTS);
}
function save(plans) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(plans, null, 2), 'utf8');
}

let plans = load();

function list({ onlyActive = false } = {}) {
  return onlyActive ? plans.filter(p => p.active) : plans.slice();
}
function get(code) { return plans.find(p => p.code === code) || null; }

/** Modification manuelle par l'admin. Valide chaque champ, ne casse jamais un plan. */
function update(code, patch = {}) {
  const plan = get(code);
  if (!plan) return { error: 'Plan introuvable' };
  if (patch.name !== undefined) plan.name = String(patch.name).slice(0, 40) || plan.name;
  if (patch.priceMonthly !== undefined) {
    const v = Number(patch.priceMonthly);
    if (!Number.isFinite(v) || v < 0) return { error: 'Prix invalide : indiquez un nombre supérieur ou égal à 0.' };
    plan.priceMonthly = Math.round(v * 100) / 100;
  }
  if (patch.currency !== undefined) {
    const c = String(patch.currency).toUpperCase().slice(0, 5);
    if (!/^[A-Z]{3,5}$/.test(c)) return { error: 'Devise invalide (ex : USD, CDF, XOF, XAF).' };
    plan.currency = c;
  }
  if (patch.creditsIncluded !== undefined) {
    const v = parseInt(patch.creditsIncluded, 10);
    if (!Number.isFinite(v) || v < 0) return { error: 'Crédits invalides.' };
    plan.creditsIncluded = v;
  }
  if (patch.maxAssistants !== undefined) {
    const v = parseInt(patch.maxAssistants, 10);
    if (!Number.isFinite(v) || v < 1) return { error: 'Nombre d\'assistants invalide.' };
    plan.maxAssistants = v;
  }
  if (patch.active !== undefined) plan.active = Boolean(patch.active);
  if (Array.isArray(patch.features)) plan.features = patch.features.map(f => String(f).slice(0, 80)).slice(0, 10);
  plan.updatedAt = new Date().toISOString();
  save(plans);
  return { plan };
}

function create(input = {}) {
  const code = String(input.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
  if (!code) return { error: 'Code du plan manquant (ex : premium).' };
  if (get(code)) return { error: 'Un plan avec ce code existe déjà.' };
  const plan = {
    code, name: String(input.name || code).slice(0, 40),
    priceMonthly: Math.max(0, Number(input.priceMonthly) || 0),
    currency: String(input.currency || 'USD').toUpperCase().slice(0, 5),
    creditsIncluded: Math.max(0, parseInt(input.creditsIncluded, 10) || 0),
    maxAssistants: Math.max(1, parseInt(input.maxAssistants, 10) || 1),
    active: true, features: Array.isArray(input.features) ? input.features : [],
    createdAt: new Date().toISOString(),
  };
  plans.push(plan); save(plans);
  return { plan };
}

function remove(code) {
  if (['starter'].includes(code) && plans.length <= 1) return { error: 'Impossible de supprimer le dernier plan.' };
  const before = plans.length;
  plans = plans.filter(p => p.code !== code);
  if (plans.length === before) return { error: 'Plan introuvable' };
  save(plans);
  return { removed: true };
}

module.exports = { list, get, update, create, remove };
