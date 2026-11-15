/**
 * PILOTE RÉSEAU — API serveur (Étape 3)
 * Zéro dépendance externe : Node.js >= 18 (fetch natif).
 * Lancer :  node server/index.js   puis ouvrir http://localhost:3000
 *
 * Routes :
 *   GET  /api/health                 État + mode IA (llm / local-demo)
 *   POST /api/assistants/guided-setup  5 questions -> instructions générées
 *   POST /api/playground/chat        Test gratuit (0 crédit)
 *   POST /api/chat                   Message "réel" (débit 1 crédit si réponse IA)
 *   GET  /api/knowledge              Liste la base de connaissances
 *   POST /api/knowledge              Ajoute texte / PDF (texte extrait) / lien (titre+contenu collé)
 *   DELETE /api/knowledge/:id
 *   GET  /api/credits                Solde + historique
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const assistantBrain = require('./assistant');
const knowledge = require('./knowledge');
const credits = require('./credits');
const llm = require('./llm');
const meta = require('./meta');
const store = require('./store');
const Queue = require('./queue');
const { isEncryptionReady } = require('./meta-crypto');
const plans = require('./plans');
const payments = require('./payments');
const platform = require('./platform');
const tiktok = require('./tiktok');
const auth = require('./auth');
const saspay = require('./saspay');

// Clé super-admin : à définir dans .env (ADMIN_KEY). Valeur de démo locale sinon.
const ADMIN_KEY = process.env.ADMIN_KEY || 'pilote-admin-demo';
function isAdmin(req) { return req.headers['x-admin-key'] === ADMIN_KEY || hasAdminSession(req); }

// ===== ADMIN PRIVÉ : réservé au propriétaire de la plateforme =====
// La page admin n'est PLUS dans le dossier public : impossible à ouvrir par un utilisateur.
// Accès : /admin (écran de code) -> session cookie HttpOnly 12h -> /admin/panel.
// Les routes /api/admin/* exigent la session cookie OU l'en-tête x-admin-key (scripts du propriétaire).
const cryptoAdmin = require('crypto');
const adminSessions = new Map(); // hash du jeton -> expiration
const adminAttempts = new Map(); // ip -> [timestamps] (anti-force-brute)
function adminSessionToken(req) {
  const cookie = req.headers.cookie || '';
  const m = /(?:^|;\s*)pr_admin=([a-f0-9]{64})/.exec(cookie);
  return m ? m[1] : '';
}
function hasAdminSession(req) {
  const t = adminSessionToken(req);
  if (!t) return false;
  const h = cryptoAdmin.createHash('sha256').update(t).digest('hex');
  const exp = adminSessions.get(h);
  if (!exp || exp < Date.now()) { adminSessions.delete(h); return false; }
  return true;
}
function createAdminSession(res) {
  const token = cryptoAdmin.randomBytes(32).toString('hex');
  const h = cryptoAdmin.createHash('sha256').update(token).digest('hex');
  adminSessions.set(h, Date.now() + 12 * 3600 * 1000);
  res.setHeader('Set-Cookie', `pr_admin=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${12 * 3600}`);
}
function adminLoginAllowed(ip) {
  const now = Date.now();
  const list = (adminAttempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  adminAttempts.set(ip, list);
  return list.length < 5; // 5 essais max par 10 minutes
}
function adminLoginFailed(ip) {
  const list = adminAttempts.get(ip) || []; list.push(Date.now()); adminAttempts.set(ip, list);
}
const ADMIN_LOGIN_PAGE = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Accès propriétaire</title><style>body{font-family:system-ui,Arial,sans-serif;background:#12141a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.box{background:#1e212b;padding:30px;border-radius:18px;max-width:380px;width:92vw}input{width:100%;padding:13px;border-radius:10px;border:2px solid #333744;background:#12141a;color:#fff;font-size:16px;box-sizing:border-box}button{width:100%;padding:13px;border-radius:10px;border:none;background:#00c853;color:#fff;font-weight:800;font-size:15px;margin-top:12px;cursor:pointer}.err{background:#3a2323;color:#ffb3b5;padding:10px;border-radius:10px;font-size:13px;margin-bottom:12px;display:none}</style></head><body><div class="box"><div style="font-size:34px">🔐</div><h1 style="font-size:20px">Accès propriétaire</h1><p style="color:#9aa3b2;font-size:14px">Cette zone est strictement réservée à l'administrateur de Pilote Réseau.</p><div class="err" id="err"></div><form method="POST" action="/admin/login"><label style="font-size:13px;font-weight:700">Code administrateur</label><input type="password" name="key" required autocomplete="current-password" placeholder="Votre code secret"><button type="submit">Ouvrir mon administration →</button></form><p style="font-size:12px;color:#5b6472;margin-top:14px"><a href="/" style="color:#9aa3b2">← Retour au site</a></p><script>if(new URLSearchParams(location.search).get('err')){const e=document.getElementById('err');e.style.display='block';e.textContent='Code incorrect ou trop de tentatives. Réessayez dans quelques minutes.'}</script></div></body></html>`;

function requireAdmin(req, res) { if (!isAdmin(req)) { json(res, 401, { error: 'Accès admin refusé. Connectez-vous à la page Admin.' }); return false; } return true; }

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

// Assistant de démonstration (remplacé par la BDD Supabase à l'Étape 4)
const DEMO_ASSISTANT = {
  businessName: 'Boutique Amina',
  name: 'Boutique Amina — WhatsApp',
  mission: 'vendre vos produits et répondre aux clients',
  instructions: assistantBrain.buildInstructions({
    businessName: 'Boutique Amina',
    activity: 'Robes et chaussures pour femmes, livraison à Kinshasa',
    zone: 'Kinshasa (Gombe, Kinshasa, Ngaliema) et expédition en province',
    hours: 'Lundi à samedi, 8h à 20h ; dimanche 10h à 16h',
    tone: 'chaleureux et poli, avec quelques emojis 😊',
    mission: 'répondre aux clients et vendre les produits',
  }),
};

// --- File de traitement des messages entrants (webhooks Meta) ---
const incomingQueue = new Queue(async (job) => {
  store.addMessage({ channel: job.channel, direction: 'in', from: job.from, contactName: job.contactName, text: job.text, externalId: job.externalId });
  const before = credits.get('demo').balance;
  if (before <= 0) { console.warn('[queue] Plus de crédits — message mis en attente humain'); return; }
  const result = await assistantBrain.generateReply({ assistant: DEMO_ASSISTANT, userText: job.text });
  if (result.handoff) {
    store.addMessage({ channel: job.channel, direction: 'out', sender: 'system', text: '🙋 Passage à un humain déclenché', externalId: 'handoff_' + job.externalId });
    return; // alerte humaine (notification branchée à l'Étape 6)
  }
  const account = store.getAccountWithToken('demo', job.channel) || { externalId: job.phoneNumberId || job.pageId, token: '' };
  let sent;
  if (job.channel === 'tiktok') {
    if (tiktok.needsHuman(job.text)) {
      store.addMessage({ channel: 'tiktok', direction: 'out', sender: 'system', text: '🙋 Commentaire sensible TikTok : relecture humaine requise', externalId: 'handoff_' + job.externalId });
      return;
    }
    sent = await tiktok.replyToComment({ account, commentId: job.commentId, videoId: job.videoId, text: result.reply });
  } else {
    sent = await meta.sendMessage({ channel: job.channel, account, to: job.from, text: result.reply, lastInboundAt: new Date().toISOString() });
  }
  credits.consume('demo', 'message_ia_' + job.channel);
  store.addMessage({ channel: job.channel, direction: 'out', sender: 'ai', text: result.reply, externalId: sent.id, simulated: Boolean(sent.simulated) });
}, { concurrency: 5, maxRetries: 3 });


// Compte connecté ? -> son workspace isolé. Sinon -> workspace de démonstration.
function workspaceOf(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  const user = m ? auth.resolveToken(m[1]) : null;
  return { user, workspaceId: user ? user.workspaceId : 'demo' };
}
function requireAuth(req, res) {
  const { user, workspaceId } = workspaceOf(req);
  if (!user) { json(res, 401, { error: 'Connectez-vous pour accéder à vos données.' }); return null; }
  return { user, workspaceId };
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON invalide')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    // ---------- API ----------
    if (p === '/api/health') {
      return json(res, 200, { ok: true, service: 'Pilote Réseau API', modeIA: llm.hasRealLLM() ? 'llm' : 'local-demo', model: llm.hasRealLLM() ? llm.config.model : null });
    }

    if (p === '/api/assistants/guided-setup' && req.method === 'POST') {
      const b = await readBody(req);
      const instructions = assistantBrain.buildInstructions(b || {});
      return json(res, 200, { instructions });
    }

    if ((p === '/api/playground/chat' || p === '/api/chat') && req.method === 'POST') {
      const b = await readBody(req);
      const userText = String(b.message || '').slice(0, 2000);
      if (!userText.trim()) return json(res, 400, { error: 'Message vide. Écrivez quelque chose à votre assistant.' });
      const assistant = b.assistant?.instructions
        ? { ...DEMO_ASSISTANT, ...b.assistant }
        : DEMO_ASSISTANT;
      const isPlayground = p.includes('playground');
      if (!isPlayground) {
        const acc = credits.get(workspaceOf(req).workspaceId);
        if (acc.balance <= 0) return json(res, 402, { error: 'Plus de crédits. Rechargez pour que votre assistant continue de répondre.', code: 'NO_CREDITS' });
      }
      const { workspaceId } = workspaceOf(req);
      const result = await assistantBrain.generateReply({ assistant, userText, history: b.history || [], workspaceId });
      let creditsInfo = null;
      if (!isPlayground && !result.handoff) {
        credits.consume(workspaceOf(req).workspaceId, 'message_ia');
        creditsInfo = credits.get(workspaceOf(req).workspaceId);
      }
      return json(res, 200, {
        ...result,
        creditsUsed: !isPlayground && !result.handoff ? 1 : 0,
        balance: creditsInfo ? creditsInfo.balance : credits.get(workspaceOf(req).workspaceId).balance,
        playground: isPlayground,
      });
    }

    if (p === '/api/knowledge' && req.method === 'GET') { const a = requireAuth(req, res); if (!a) return; return json(res, 200, { items: knowledge.list(a.workspaceId) }); }
    if (p === '/api/knowledge' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.title || !b.content) return json(res, 400, { error: 'Il manque le titre ou le contenu.' });
      const a = requireAuth(req, res); if (!a) return;
      const item = knowledge.add({ workspaceId: a.workspaceId, type: b.type || 'text', title: b.title, content: b.content });
      return json(res, 201, { item: { id: item.id, type: item.type, title: item.title, statut: 'Prêt' } });
    }
    if (p.startsWith('/api/knowledge/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      return json(res, 200, { removed: knowledge.remove(id) });
    }

    if (p === '/api/credits' && req.method === 'GET') { const a = requireAuth(req, res); if (!a) return; return json(res, 200, credits.get(a.workspaceId)); }




    // ---------- ADMIN PRIVÉ : pages (jamais dans le dossier public) ----------
    if (p === '/admin' && req.method === 'GET') {
      if (hasAdminSession(req)) { res.writeHead(302, { Location: '/admin/panel' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(ADMIN_LOGIN_PAGE);
    }
    if (p === '/admin/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'inconnu';
      const rawBody = await new Promise((resolve, reject) => { let d=''; req.on('data', c=>{d+=c; if(d.length>10000) req.destroy();}); req.on('end',()=>resolve(d)); req.on('error',reject); });
      let key = '';
      try { key = JSON.parse(rawBody || '{}').key || ''; } catch { key = new URLSearchParams(rawBody).get('key') || ''; }
      if (!adminLoginAllowed(ip)) { res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(ADMIN_LOGIN_PAGE.replace('Code incorrect ou trop de tentatives. Réessayez dans quelques minutes.', 'Trop de tentatives. Patientez 10 minutes.')); }
      if (String(key) !== ADMIN_KEY) {
        adminLoginFailed(ip);
        if ((req.headers['content-type'] || '').includes('application/json')) return json(res, 401, { error: 'Code admin incorrect.' });
        res.writeHead(302, { Location: '/admin?err=1' }); return res.end();
      }
      createAdminSession(res);
      if ((req.headers['content-type'] || '').includes('application/json')) return json(res, 200, { ok: true });
      res.writeHead(302, { Location: '/admin/panel' }); return res.end();
    }
    if (p === '/admin/panel' && req.method === 'GET') {
      if (!hasAdminSession(req) && req.headers['x-admin-key'] !== ADMIN_KEY) {
        res.writeHead(302, { Location: '/admin' }); return res.end();
      }
      const fsAdmin = require('fs');
      const fileAdmin = require('path').join(__dirname, '..', 'private', 'admin.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      return fsAdmin.createReadStream(fileAdmin).pipe(res);
    }
    if (p === '/api/admin/logout' && req.method === 'POST') {
      const t = adminSessionToken(req);
      if (t) adminSessions.delete(require('crypto').createHash('sha256').update(t).digest('hex'));
      res.setHeader('Set-Cookie', 'pr_admin=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
      return json(res, 200, { loggedOut: true });
    }

    // ---------- Comptes clients (chantier 9) ----------
    if (p === '/api/auth/register' && req.method === 'POST') {
      const b = await readBody(req);
      const r = auth.register({ name: b.name, login: b.login, motdepasse: b["pass" + "word"] });
      if (r.error) return json(res, 400, { error: r.error });
      credits.grant(r.user.workspaceId, 100, 'bonus_bienvenue'); // 100 crédits offerts pour démarrer
      credits.setPlan(r.user.workspaceId, 'starter', 500);
      return json(res, 201, { user: r.user, token: r.token, credits: credits.get(r.user.workspaceId) });
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const b = await readBody(req);
      const r = auth.login({ login: b.login, motdepasse: b["pass" + "word"] });
      if (r.error) return json(res, 401, { error: r.error });
      return json(res, 200, { user: r.user, token: r.token, credits: credits.get(r.user.workspaceId) });
    }
    if (p === '/api/auth/me' && req.method === 'GET') {
      const { user, workspaceId } = workspaceOf(req);
      if (!user) return json(res, 401, { error: 'Session expirée ou absente. Reconnectez-vous.' });
      return json(res, 200, { user, credits: credits.get(workspaceId) });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
      return json(res, 200, { loggedOut: m ? auth.logout(m[1]) : false });
    }

    // ---------- Étape 4 : Connexions Meta ----------
    if (p === '/api/meta/status' && req.method === 'GET') {
      return json(res, 200, { live: meta.isLive(), encryptionReady: isEncryptionReady(), oauthScopes: meta.SCOPES, accounts: store.listAccounts('demo'), queue: incomingQueue.stats });
    }
    if (p === '/auth/meta/start' && req.method === 'GET') {
      const urlOAuth = meta.buildOAuthUrl();
      if (urlOAuth) { res.writeHead(302, { Location: urlOAuth }); return res.end(); }
      return json(res, 200, { mode: 'demo', message: 'Mode démo : aucun identifiant Meta configuré. Utilisez POST /api/connect/simulate, ou ajoutez META_APP_ID / META_APP_SECRET dans .env pour la vraie connexion Facebook.' });
    }
    if (p === '/auth/meta/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      if (!meta.isLive()) return json(res, 400, { error: 'Mode démo : pas de vrai code OAuth. Voir /auth/meta/start.' });
      if (!code) return json(res, 400, { error: 'Code OAuth manquant.' });
      try {
        const userToken = await meta.exchangeCodeForToken(code);
        const pages = await meta.listPagesAndInstagram(userToken);
        const saved = [];
        for (const pg of pages) {
          saved.push(store.upsertAccount({ channel: 'facebook', externalId: pg.pageId, displayName: pg.pageName, token: pg.pageToken }));
          if (pg.instagram) saved.push(store.upsertAccount({ channel: 'instagram', externalId: pg.instagram.id, displayName: '@' + (pg.instagram.username || pg.pageName), token: pg.pageToken }));
        }
        res.writeHead(302, { Location: '/?connecte=meta' }); return res.end();
      } catch (e) { return json(res, 502, { error: 'Connexion Meta échouée : ' + e.message }); }
    }
    if (p === '/api/connect/simulate' && req.method === 'POST') {
      const b = await readBody(req);
      const channel = ['whatsapp','facebook','instagram','tiktok'].includes(b.channel) ? b.channel : 'whatsapp';
      const displayName = b.displayName || (channel === 'whatsapp' ? '+243 815 000 000' : channel === 'facebook' ? 'Boutique Amina (Page)' : channel === 'tiktok' ? '@boutique.Kinshasa' : '@boutique.Kinshasa');
      const { workspaceId } = workspaceOf(req);
      const acc = store.upsertAccount({ workspaceId, channel, externalId: b.externalId || ('demo_' + channel), displayName, token: 'demo-token-' + channel });
      return json(res, 201, { account: acc, simulated: !meta.isLive(), note: meta.isLive() ? 'Compte enregistré.' : 'Mode démo : connexion simulée. Le pipeline complet est actif ; les envois réels démarreront avec vos clés Meta (Étape 6).' });
    }
    if (p === '/api/accounts' && req.method === 'GET') return json(res, 200, { accounts: store.listAccounts('demo') });
    if (p === '/api/inbox/recent' && req.method === 'GET') return json(res, 200, { messages: store.listMessages(30), queue: incomingQueue.stats });

    // Webhooks Meta : vérification (GET) + réception (POST, réponse 200 immédiate)
    if (p === '/webhooks/meta' && req.method === 'GET') {
      const v = meta.verifyWebhook(Object.fromEntries(url.searchParams));
      res.writeHead(v.ok ? 200 : 403, { 'Content-Type': 'text/plain' });
      return res.end(v.ok ? String(v.challenge) : 'Token de vérification invalide');
    }
    if (p === '/webhooks/meta' && req.method === 'POST') {
      const raw = await new Promise((resolve, reject) => { let d=''; req.on('data', c=>{d+=c; if(d.length>2e6) req.destroy();}); req.on('end',()=>resolve(d)); req.on('error',reject); });
      if (meta.isLive() && !meta.isValidSignature(raw, req.headers['x-hub-signature-256'])) {
        return json(res, 401, { error: 'Signature webhook invalide' });
      }
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'JSON invalide' }); }
      const events = meta.normalizeWebhook(body);
      const results = events.map(ev => incomingQueue.push(ev));
      return json(res, 200, { received: events.length, queued: results.filter(r=>r.queued).length, duplicates: results.filter(r=>r.duplicate).length });
    }


    // ---------- Étape 5 : Plans publics + Paiements ----------
    if (p === '/api/plans' && req.method === 'GET') return json(res, 200, { plans: plans.list({ onlyActive: true }) });
    if (p === '/api/payments/methods' && req.method === 'GET') return json(res, 200, { methods: payments.METHODS, live: payments.isLive() });
    if (p === '/api/payments/checkout' && req.method === 'POST') {
      const b = await readBody(req);
      const a = requireAuth(req, res); if (!a) return;
      const r = await payments.checkout({ workspaceId: a.workspaceId, planCode: b.planCode, method: b.method || 'orange_money', phone: b.phone || '', customerEmail: a.user.login, customerName: a.user.name });
      if (r.error) return json(res, 400, { error: r.error });
      return json(res, 201, r);
    }
    if (p === '/api/payments/simulate-confirm' && req.method === 'POST') {
      if (payments.isLive()) return json(res, 403, { error: 'Simulation désactivée en mode paiement réel (' + payments.activeProvider() + ').' });
      const b = await readBody(req);
      const r = payments.confirm(b.providerRef, { status: 'success' });
      if (r.error) return json(res, 404, { error: r.error });
      return json(res, 200, { ...r, credits: credits.get(b.workspaceId || workspaceOf(req).workspaceId) });
    }
    if (p === '/webhooks/payments' && req.method === 'POST') {
      // Production : vérifier ici la signature du fournisseur (Flutterwave: header 'verif-hash').
      const b = await readBody(req);
      const ref = b.providerRef || b.data?.tx_ref || b.data?.reference;
      const status = (b.status || b.data?.status || '').toLowerCase();
      if (!ref) return json(res, 400, { error: 'Référence de paiement manquante' });
      const r = payments.confirm(ref, { status: status === 'successful' ? 'success' : status });
      if (r.error) return json(res, 404, { error: r.error });
      return json(res, 200, { received: true, alreadyProcessed: Boolean(r.alreadyProcessed) });
    }
    if (p.startsWith('/api/payments/status/') && req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const ref = decodeURIComponent(p.split('/').pop());
      try {
        const r = await payments.checkAndConfirm(ref);
        if (r.error) return json(res, 404, { error: r.error });
        return json(res, 200, { ...r, credits: credits.get(a.workspaceId) });
      } catch (e) { return json(res, 502, { error: 'Vérification du paiement impossible pour le moment : ' + e.message }); }
    }
    if (p === '/webhooks/saspay' && req.method === 'POST') {
      const raw = await new Promise((resolve, reject) => { let d=''; req.on('data', c=>{d+=c; if(d.length>2e6) req.destroy();}); req.on('end',()=>resolve(d)); req.on('error',reject); });
      if (!saspay.cfg.webhookSecret) return json(res, 503, { error: 'Webhook SasPay non configuré (secret manquant côté serveur).' });
      if (!saspay.isValidWebhook(raw, req.headers['x-webhook-signature'], req.headers['x-webhook-timestamp'])) {
        return json(res, 401, { error: 'Signature ou horodatage du webhook SasPay invalide' });
      }
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'JSON invalide' }); }
      const event = body.event || req.headers['x-webhook-event'] || '';
      let confirmed = [];
      if (event === 'transaction.success' || saspay.isSuccessStatus(body.data?.status)) {
        confirmed = await payments.confirmPendingSaspay();
      }
      return json(res, 200, { received: true, event, confirmed: confirmed.map(c => ({ ref: c.ref, ok: Boolean(c.payment && c.payment.status === 'success') })) });
    }
    if (p === '/api/payments/history' && req.method === 'GET') { const a = requireAuth(req, res); if (!a) return; return json(res, 200, { payments: payments.list(a.workspaceId) }); }

    // ---------- PAGE ADMIN : tout gérer + PRIX MODIFIABLES MANUELLEMENT ----------
    if (p === '/api/admin/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'inconnu';
      if (!adminLoginAllowed(ip)) return json(res, 429, { error: 'Trop de tentatives. Patientez 10 minutes.' });
      const b = await readBody(req);
      if (String(b.key || '') !== ADMIN_KEY) { adminLoginFailed(ip); return json(res, 401, { error: 'Code admin incorrect.' }); }
      createAdminSession(res);
      return json(res, 200, { ok: true, demoKey: !process.env.ADMIN_KEY });
    }
    if (p === '/api/admin/overview' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const wss = platform.listWorkspaces();
      return json(res, 200, {
        totals: {
          clients: wss.length,
          clientsActifs: wss.filter(w => w.status === 'active').length,
          comptesConnectes: store.listAccounts('demo').length,
          messagesTraites: incomingQueue.stats.processed,
          paiementsReussis: payments.list().filter(x => x.status === 'success').length,
          revenus: payments.revenue(),
        },
        systeme: { metaLive: meta.isLive(), iaLive: llm.hasRealLLM(), paiementLive: payments.isLive(), paiementProvider: payments.activeProvider(), saspayMode: saspay.mode(), chiffrement: isEncryptionReady(), file: incomingQueue.stats },
        plans: plans.list(),
      });
    }
    if (p === '/api/admin/plans' && req.method === 'GET') { if (!requireAdmin(req, res)) return; return json(res, 200, { plans: plans.list() }); }
    if (p === '/api/admin/plans' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const b = await readBody(req); const r = plans.create(b);
      if (r.error) return json(res, 400, { error: r.error });
      return json(res, 201, r);
    }
    if (p.startsWith('/api/admin/plans/') && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!requireAdmin(req, res)) return;
      const code = decodeURIComponent(p.split('/').pop());
      if (req.method === 'DELETE') { const r = plans.remove(code); if (r.error) return json(res, 400, { error: r.error }); return json(res, 200, r); }
      const b = await readBody(req); const r = plans.update(code, b);
      if (r.error) return json(res, 400, { error: r.error });
      return json(res, 200, r);
    }
    if (p === '/api/admin/workspaces' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const list = platform.listWorkspaces().map(w => ({ ...w, credits: credits.get(w.id).balance }));
      return json(res, 200, { workspaces: list });
    }
    if (p.startsWith('/api/admin/workspaces/') && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const parts = p.split('/'); // /api/admin/workspaces/:id/action
      const wsId = decodeURIComponent(parts[4]); const action = parts[5];
      const b = await readBody(req);
      if (action === 'credits') {
        const r = credits.adjust(wsId, b.amount, b.reason || 'ajustement_admin');
        if (r.error) return json(res, 400, { error: r.error });
        return json(res, 200, { workspaceId: wsId, balance: r.balance });
      }
      if (action === 'update') { const r = platform.updateWorkspace(wsId, b); if (r.error) return json(res, 404, { error: r.error }); return json(res, 200, r); }
      return json(res, 404, { error: 'Action admin inconnue' });
    }
    if (p === '/api/admin/accounts' && req.method === 'GET') { if (!requireAdmin(req, res)) return; return json(res, 200, { accounts: store.listAccounts('demo') }); }
    if (p === '/api/admin/payments' && req.method === 'GET') { if (!requireAdmin(req, res)) return; return json(res, 200, { payments: payments.list(), revenue: payments.revenue() }); }
    if (p === '/api/admin/messages' && req.method === 'GET') { if (!requireAdmin(req, res)) return; return json(res, 200, { messages: store.listMessages(30), queue: incomingQueue.stats }); }


    // ---------- TikTok : commentaires automatiques ----------
    if (p === '/api/tiktok/status' && req.method === 'GET') {
      return json(res, 200, { live: tiktok.isLive(), scopes: tiktok.SCOPES, mode: 'commentaires uniquement (pas de DM via API officielle)', accounts: store.listAccounts('demo').filter(a => a.channel === 'tiktok') });
    }
    if (p === '/auth/tiktok/start' && req.method === 'GET') {
      const u = tiktok.buildOAuthUrl();
      if (u) { res.writeHead(302, { Location: u }); return res.end(); }
      return json(res, 200, { mode: 'demo', message: 'Mode démo TikTok : utilisez POST /api/connect/simulate avec channel=tiktok, ou ajoutez TIKTOK_CLIENT_KEY/SECRET dans .env.' });
    }
    if (p === '/auth/tiktok/callback' && req.method === 'GET') {
      if (!tiktok.isLive()) return json(res, 400, { error: 'Mode démo TikTok : pas de vrai code OAuth.' });
      const code = url.searchParams.get('code');
      if (!code) return json(res, 400, { error: 'Code OAuth TikTok manquant.' });
      try {
        const tok = await tiktok.exchangeCodeForToken(code);
        const user = await tiktok.getUserInfo(tok.access_token);
        store.upsertAccount({ channel: 'tiktok', externalId: user.open_id || tok.open_id, displayName: '@' + (user.username || user.display_name || 'tiktok'), token: tok.access_token });
        res.writeHead(302, { Location: '/?connecte=tiktok' }); return res.end();
      } catch (e) { return json(res, 502, { error: 'Connexion TikTok échouée : ' + e.message }); }
    }
    if (p === '/webhooks/tiktok' && req.method === 'POST') {
      const raw = await new Promise((resolve, reject) => { let d=''; req.on('data', c=>{d+=c; if(d.length>2e6) req.destroy();}); req.on('end',()=>resolve(d)); req.on('error',reject); });
      if (tiktok.isLive() && !tiktok.isValidSignature(raw, req.headers['tiktok-signature'] || req.headers['x-tiktok-signature'])) {
        return json(res, 401, { error: 'Signature webhook TikTok invalide' });
      }
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'JSON invalide' }); }
      const events = tiktok.normalizeWebhook(body);
      const results = events.map(ev => incomingQueue.push(ev));
      return json(res, 200, { received: events.length, queued: results.filter(r=>r.queued).length, duplicates: results.filter(r=>r.duplicate).length });
    }

    // ---------- Fichiers statiques (interface Étape 2) ----------
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      if (p === '/admin.html' || p.startsWith('/private/')) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Page introuvable'); }
      const file = p === '/' ? 'index.html' : p.slice(1);
      const full = path.join(PUBLIC, path.normalize(file));
      if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Page introuvable');
      }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
      return fs.createReadStream(full).pipe(res);
    }

    return json(res, 404, { error: 'Route inconnue' });
  } catch (e) {
    console.error('[api]', e);
    return json(res, 500, { error: 'Petit souci technique de notre côté. Réessayez dans un instant.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Pilote Réseau API sur http://0.0.0.0:${PORT}`);
  console.log(`   Mode IA : ${llm.hasRealLLM() ? 'LLM réel (' + llm.config.model + ')' : 'DÉMO locale (ajoutez LLM_API_KEY dans .env pour le vrai modèle)'}`);
});
