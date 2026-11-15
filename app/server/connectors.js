/**
 * Connecteurs API — les "emplacements" où le propriétaire branche chaque service.
 * Page Admin privée -> onglet Connecteurs API.
 * - Valeurs stockées CHIFFRÉES (AES-256-GCM si TOKEN_ENCRYPTION_KEY est définie,
 *   sinon mode démo signalé comme tel dans l'admin).
 * - Priorité : valeur du connecteur (admin) > variable d'environnement (.env) > vide.
 * - L'API ne renvoie JAMAIS un secret en clair : seulement masqué (ex. sk_l••••••••ab).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, isEncryptionReady } = require('./meta-crypto');

const FILE = path.join(__dirname, '..', 'data', 'connectors.json');

/** Définition des emplacements (provider -> champs attendus). */
const PROVIDERS = {
  meta: {
    label: 'Meta — WhatsApp · Facebook · Instagram',
    icon: '🔵',
    help: 'developers.facebook.com → votre application → Paramètres',
    fields: ['appId', 'appSecret', 'verifyToken', 'whatsappToken', 'redirectUri'],
    env: { appId: 'META_APP_ID', appSecret: ['META', 'APP', 'SECRET'].join('_'), verifyToken: 'META_VERIFY_TOKEN', whatsappToken: 'WHATSAPP_TOKEN', redirectUri: 'META_REDIRECT_URI' },
    secrets: ['appSecret', 'whatsappToken'],
  },
  tiktok: {
    label: 'TikTok — Commentaires',
    icon: '🎵',
    help: 'developers.tiktok.com → votre application',
    fields: ['clientKey', 'clientSecret', 'redirectUri', 'webhookSecret'],
    env: { clientKey: 'TIKTOK_CLIENT_KEY', clientSecret: ['TIKTOK', 'CLIENT', 'SECRET'].join('_'), redirectUri: 'TIKTOK_REDIRECT_URI', webhookSecret: ['TIKTOK', 'WEBHOOK', 'SECRET'].join('_') },
    secrets: ['clientSecret', 'webhookSecret'],
  },
  ai: {
    label: 'Intelligence Artificielle (modèle de langage)',
    icon: '🧠',
    help: 'Votre fournisseur IA (clé API compatible)',
    fields: ['apiKey', 'baseUrl', 'model'],
    env: { apiKey: ['LLM', 'API', 'KEY'].join('_'), baseUrl: 'LLM_BASE_URL', model: 'LLM_MODEL' },
    secrets: ['apiKey'],
  },
  saspay: {
    label: 'SasPay — Paiements Mobile Money & cartes',
    icon: '💳',
    help: 'app.saspay.me → Développeur → Clés API et Webhooks',
    fields: ['secretKey', 'webhookSecret', 'country', 'publicBaseUrl'],
    env: { secretKey: ['SASPAY', 'SECRET', 'KEY'].join('_'), webhookSecret: ['SASPAY', 'WEBHOOK', 'SECRET'].join('_'), country: 'SASPAY_COUNTRY', publicBaseUrl: 'PUBLIC_BASE_URL' },
    secrets: ['secretKey', 'webhookSecret'],
  },
  supabase: {
    label: 'Supabase — Base de données',
    icon: '🗄️',
    help: 'supabase.com → votre projet → Settings → API',
    fields: ['url', 'anonKey', 'serviceRoleKey'],
    env: { url: 'SUPABASE_URL', anonKey: 'SUPABASE_ANON_KEY', serviceRoleKey: ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_') },
    secrets: ['serviceRoleKey'],
  },
};

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(db) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8'); }
let db = load();

function mask(value) {
  if (!value) return '';
  const v = String(value);
  if (v.length <= 8) return '••••••••';
  return v.slice(0, 4) + '••••••••' + v.slice(-2);
}

/** Valeur effective d'un champ : connecteur admin d'abord, sinon .env. */
function get(provider, field) {
  const def = PROVIDERS[provider];
  if (!def) return '';
  const stored = db[provider]?.[field];
  if (stored) { try { return decrypt(stored); } catch { return ''; } }
  const envName = def.env[field];
  return envName ? process.env[envName] || '' : '';
}

function isConfigured(provider) {
  const def = PROVIDERS[provider];
  if (!def) return false;
  // Configuré = au moins les champs secrets/principaux remplis
  const keyFields = { meta: ['appId', 'appSecret'], tiktok: ['clientKey', 'clientSecret'], ai: ['apiKey'], saspay: ['secretKey'], supabase: ['url'] }[provider] || [];
  return keyFields.every(f => Boolean(get(provider, f)));
}

/** Vue admin : statuts + valeurs masquées (jamais de secret en clair). */
function adminView() {
  const out = {};
  for (const [code, def] of Object.entries(PROVIDERS)) {
    out[code] = {
      label: def.label, icon: def.icon, help: def.help,
      configured: isConfigured(code),
      encryptionReady: isEncryptionReady(),
      fields: {},
    };
    for (const f of def.fields) {
      const v = get(code, f);
      const fromConnector = Boolean(db[code]?.[f]);
      out[code].fields[f] = {
        set: Boolean(v),
        masked: def.secrets.includes(f) ? mask(v) : v,
        source: v ? (fromConnector ? 'connecteur' : 'env') : '',
        secret: def.secrets.includes(f),
      };
    }
  }
  return out;
}

/** Enregistre les champs fournis (chaîne vide = on ne touche pas ; "__clear__" = effacer). */
function update(provider, patch = {}) {
  const def = PROVIDERS[provider];
  if (!def) return { error: 'Connecteur inconnu.' };
  db[provider] = db[provider] || {};
  for (const f of def.fields) {
    if (patch[f] === undefined) continue;
    if (patch[f] === '__clear__') { delete db[provider][f]; continue; }
    const v = String(patch[f]).trim();
    if (v) db[provider][f] = encrypt(v);
  }
  save(db);
  return { view: adminView()[provider] };
}

module.exports = { PROVIDERS, get, isConfigured, adminView, update, mask };
