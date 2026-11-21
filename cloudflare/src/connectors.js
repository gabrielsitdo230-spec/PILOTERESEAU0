/**
 * PILOTE RÉSEAU — Connecteurs API version Workers (page Admin en ligne)
 * --------------------------------------------------------------------
 * Sur Workers, un programme ne peut pas modifier ses propres Secrets.
 * Les clés collées dans la page Admin sont donc stockées dans KV
 * (binding PILOTE_KV), CHIFFRÉES AES-256-GCM avec TOKEN_ENCRYPTION_KEY
 * (même format v1:iv:tag:data que le serveur Node). Jamais en clair,
 * jamais renvoyées au navigateur (vue masquée uniquement).
 * Priorité : valeur Admin (KV) > Secret Worker (env).
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((String(s).match(/.{2}/g) || []).map(h => parseInt(h, 16)));

export const PROVIDERS = {
  meta: { label: 'Meta — WhatsApp · Facebook · Instagram', icon: '🔵', fields: ['appId', 'appSecret', 'verifyToken', 'whatsappToken'], secrets: ['appSecret', 'whatsappToken'],
    env: { appId: 'META_APP_ID', appSecret: 'META_APP_SECRET', verifyToken: 'META_VERIFY_TOKEN', whatsappToken: 'WHATSAPP_TOKEN' } },
  tiktok: { label: 'TikTok — Commentaires', icon: '🎵', fields: ['clientKey', 'clientSecret', 'webhookSecret'], secrets: ['clientSecret', 'webhookSecret'],
    env: { clientKey: 'TIKTOK_CLIENT_KEY', clientSecret: 'TIKTOK_CLIENT_SECRET', webhookSecret: 'TIKTOK_WEBHOOK_SECRET' } },
  ai: { label: 'Intelligence Artificielle', icon: '🧠', fields: ['apiKey', 'baseUrl', 'model'], secrets: ['apiKey'], env: { apiKey: 'LLM_API_KEY', baseUrl: 'LLM_BASE_URL', model: 'LLM_MODEL' } },
  saspay: { label: 'SasPay — Paiements', icon: '💳', fields: ['secretKey', 'webhookSecret'], secrets: ['secretKey', 'webhookSecret'],
    env: { secretKey: 'SASPAY_SECRET_KEY', webhookSecret: 'SASPAY_WEBHOOK_SECRET' } },
};
const REQUIRED = { meta: ['appId', 'appSecret'], tiktok: ['clientKey', 'clientSecret'], ai: ['apiKey'], saspay: ['secretKey', 'webhookSecret'] };

function keyBytes(env) {
  const h = env.TOKEN_ENCRYPTION_KEY || '';
  return /^[0-9a-fA-F]{64}$/.test(h) ? unhex(h) : null;
}
export const encryptionReady = (env) => Boolean(keyBytes(env));

export async function encryptValue(env, text) {
  const raw = keyBytes(env);
  if (!raw) { const e = new Error('TOKEN_ENCRYPTION_KEY manquant côté Cloudflare : impossible de garder un secret en sécurité. Ajoutez ce secret (voir guide) puis réessayez.'); e.code = 'NO_ENCRYPTION'; throw e; }
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(text))));
  const tag = out.slice(out.length - 16); const data = out.slice(0, out.length - 16);
  return ['v1', hex(iv), hex(tag), hex(data)].join(':');
}
async function decryptValue(env, payload) {
  if (!payload) return '';
  if (String(payload).startsWith('demo:')) return dec.decode(Uint8Array.from(atob(String(payload).slice(5)), c => c.charCodeAt(0)));
  const raw = keyBytes(env); if (!raw) return '';
  const [, ivHex, tagHex, dataHex] = String(payload).split(':');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const data = unhex(dataHex); const tag = unhex(tagHex);
  const joined = new Uint8Array(data.length + tag.length); joined.set(data); joined.set(tag, data.length);
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(ivHex) }, key, joined));
}

async function stored(env, provider) {
  if (!env.PILOTE_KV) return {};
  try { return JSON.parse(await env.PILOTE_KV.get('conn:' + provider) || '{}'); } catch { return {}; }
}

/** Valeurs effectives (déchiffrées, usage serveur uniquement). */
export async function get(env, provider) {
  const def = PROVIDERS[provider]; if (!def) return {};
  const saved = await stored(env, provider);
  const out = {};
  for (const f of def.fields) {
    let v = '';
    if (saved[f]) { try { v = await decryptValue(env, saved[f]); } catch { v = ''; } }
    if (!v && def.env[f] && env[def.env[f]]) v = env[def.env[f]];
    out[f] = v || '';
  }
  return out;
}
export async function isConfigured(env, provider) {
  const v = await get(env, provider);
  return (REQUIRED[provider] || []).every(f => Boolean(v[f]));
}
function mask(v) { if (!v) return ''; return v.length <= 8 ? '••••' : v.slice(0, 4) + '••••••••' + v.slice(-2); }

/** Vue Admin : jamais de secret en clair. */
export async function adminView(env) {
  const out = {};
  for (const [code, def] of Object.entries(PROVIDERS)) {
    const eff = await get(env, code);
    const saved = await stored(env, code);
    out[code] = { label: def.label, icon: def.icon, configured: await isConfigured(env, code), encryptionReady: encryptionReady(env), fields: {} };
    for (const f of def.fields) out[code].fields[f] = { set: Boolean(eff[f]), masked: mask(eff[f]), source: saved[f] ? 'admin' : (eff[f] ? 'secret-cloudflare' : ''), secret: def.secrets.includes(f) };
  }
  return out;
}

/** Enregistre les champs collés dans l'Admin (chiffrés dans KV). */
export async function update(env, provider, patch = {}) {
  const def = PROVIDERS[provider];
  if (!def) return { error: 'Connecteur inconnu.' };
  if (!env.PILOTE_KV) return { error: 'KV PILOTE_KV non lié au Worker. Vérifiez le déploiement (wrangler.jsonc) puis réessayez.' };
  const current = await stored(env, provider);
  for (const f of def.fields) {
    if (patch[f] === undefined) continue;
    if (patch[f] === '__clear__') { delete current[f]; continue; }
    const v = String(patch[f]).trim();
    if (v) current[f] = await encryptValue(env, v);
  }
  await env.PILOTE_KV.put('conn:' + provider, JSON.stringify(current));
  return { view: (await adminView(env))[provider] };
}
