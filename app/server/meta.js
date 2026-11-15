/**
 * Intégration Meta officielle — WhatsApp Business Platform, Messenger (Facebook), Instagram.
 * Documentation : https://developers.facebook.com/docs
 *
 * Mode réel   : dès que META_APP_ID + META_APP_SECRET sont dans .env.
 * Mode démo   : sans identifiants, OAuth et envois sont SIMULÉS (aucun appel externe),
 *               mais tout le pipeline (webhook -> file -> IA -> réponse) est réel.
 */
'use strict';
const crypto = require('crypto');

const GRAPH = 'https://graph.facebook.com/v21.0';
const cfg = {
  appId: process.env.META_APP_ID || '',
  appSecret: process.env.META_APP_SECRET || '',
  verifyToken: process.env.META_VERIFY_TOKEN || 'pilote-reseau-verify',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  redirectUri: process.env.META_REDIRECT_URI || 'http://localhost:3000/auth/meta/callback',
};
function isLive() { return Boolean(cfg.appId && cfg.appSecret); }

/* ---------- OAuth "Connecter avec Facebook" (Facebook + Instagram) ---------- */
const SCOPES = [
  'pages_show_list', 'pages_messaging', 'pages_manage_metadata',
  'instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments',
  'business_management',
].join(',');

function buildOAuthUrl(state) {
  if (!isLive()) return null;
  const u = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  u.searchParams.set('client_id', cfg.appId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state || crypto.randomBytes(8).toString('hex'));
  return u.toString();
}

async function exchangeCodeForToken(code) {
  const u = new URL(`${GRAPH}/oauth/access_token`);
  u.searchParams.set('client_id', cfg.appId);
  u.searchParams.set('client_secret', cfg.appSecret);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('code', code);
  const r = await fetch(u);
  const d = await r.json();
  if (!r.ok) throw new Error('Échange OAuth échoué: ' + JSON.stringify(d.error || d).slice(0, 200));
  return d.access_token; // court; à échanger ensuite contre un jeton longue durée côté production
}

async function graphGet(pathname, token, params = {}) {
  const u = new URL(GRAPH + pathname);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set('access_token', token);
  const r = await fetch(u);
  const d = await r.json();
  if (!r.ok) throw new Error(`Graph ${pathname}: ` + JSON.stringify(d.error || d).slice(0, 200));
  return d;
}
/** Après OAuth : liste des Pages Facebook et comptes Instagram liés (mode réel). */
async function listPagesAndInstagram(userToken) {
  const pages = await graphGet('/me/accounts', userToken, { fields: 'id,name,access_token,instagram_business_account{id,username,name}' });
  return (pages.data || []).map(pg => ({
    pageId: pg.id, pageName: pg.name, pageToken: pg.access_token,
    instagram: pg.instagram_business_account
      ? { id: pg.instagram_business_account.id, username: pg.instagram_business_account.username }
      : null,
  }));
}

/* ---------- Webhooks : vérification + signature ---------- */
function verifyWebhook(query) {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === cfg.verifyToken) {
    return { ok: true, challenge: query['hub.challenge'] };
  }
  return { ok: false };
}
function isValidSignature(rawBody, signatureHeader) {
  if (!cfg.appSecret) return true; // mode démo sans secret : accepté mais journalisé côté serveur
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', cfg.appSecret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader)); }
  catch { return false; }
}

/** Normalise un événement webhook Meta en message interne unique. */
function normalizeWebhook(body) {
  const events = [];
  for (const entry of body.entry || []) {
    // WhatsApp Business
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const m of v.messages || []) {
        events.push({
          channel: 'whatsapp',
          externalId: m.id, // anti-doublon
          from: m.from,
          contactName: (v.contacts || []).find(c => c.wa_id === m.from)?.profile?.name || m.from,
          text: m.text?.body || (m.type ? `[${m.type}]` : ''),
          type: m.type || 'text',
          phoneNumberId: v.metadata?.phone_number_id,
        });
      }
    }
    // Messenger (Facebook) + Instagram
    for (const ev of entry.messaging || []) {
      if (!ev.message || ev.message.is_echo) continue;
      const isIG = Boolean(ev.message.mid && entry.id && String(entry.id).length > 10 && body.object === 'instagram');
      events.push({
        channel: body.object === 'instagram' ? 'instagram' : 'facebook',
        externalId: ev.message.mid,
        from: ev.sender?.id,
        contactName: ev.sender?.id,
        text: ev.message.text || '',
        type: ev.message.text ? 'text' : 'attachment',
        pageId: entry.id,
      });
    }
    // Commentaires Instagram / Facebook
    for (const change of entry.changes || []) {
      if (change.field === 'comments' && change.value?.text) {
        events.push({
          channel: body.object === 'instagram' ? 'instagram' : 'facebook',
          externalId: change.value.id,
          from: change.value.from?.id,
          contactName: change.value.from?.username || change.value.from?.id,
          text: change.value.text,
          type: 'comment',
          mediaId: change.value.media?.id,
        });
      }
    }
  }
  return events.filter(e => e.text);
}

/* ---------- Envoi de messages (mode réel Graph API / démo simulée) ---------- */
async function graphPost(pathname, token, payload) {
  const r = await fetch(`${GRAPH}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Envoi ${pathname}: ` + JSON.stringify(d.error || d).slice(0, 240));
  return d;
}

/** Fenêtre de 24h Meta : hors fenêtre WhatsApp, seuls les modèles approuvés sont autorisés. */
function within24h(lastInboundAt) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < 24 * 3600 * 1000;
}

async function sendMessage({ channel, account, to, text, lastInboundAt }) {
  if (!isLive() && !cfg.whatsappToken) {
    return { simulated: true, id: 'sim_' + Date.now().toString(36) };
  }
  if (channel === 'whatsapp') {
    if (!within24h(lastInboundAt)) {
      const err = new Error('Hors fenêtre 24h WhatsApp : un modèle (template) approuvé est requis.');
      err.code = 'OUTSIDE_24H'; throw err;
    }
    const d = await graphPost(`/${account.externalId}/messages`, cfg.whatsappToken || account.token, {
      messaging_product: 'whatsapp', to, type: 'text', text: { body: text },
    });
    return { simulated: false, id: d.messages?.[0]?.id };
  }
  // Messenger + Instagram : même endpoint /me/messages avec le jeton de Page
  const d = await graphPost(`/${account.externalId}/messages`, account.token, {
    recipient: { id: to }, messaging_type: 'RESPONSE', message: { text },
  });
  return { simulated: false, id: d.message_id };
}

module.exports = {
  cfg, isLive, buildOAuthUrl, exchangeCodeForToken, listPagesAndInstagram,
  verifyWebhook, isValidSignature, normalizeWebhook, sendMessage, within24h, SCOPES,
};
