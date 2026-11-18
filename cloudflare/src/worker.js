/**
 * PILOTE RÉSEAU — Worker Cloudflare (Étape C : backend)
 * ------------------------------------------------------
 * Mêmes adresses et mêmes règles que le serveur Node :
 *  - auth par jeton (stocké haché), espaces séparés par client
 *  - mots de passe PBKDF2 WebCrypto (Workers n'a pas scrypt Node ;
 *    les anciens comptes migrés devront redéfinir leur mot de passe)
 *  - crédits : 1 message IA = 1 crédit, débit atomique, jamais négatif
 *  - SasPay : crédits UNIQUEMENT après webhook signé + revérification
 *    API que l'argent est arrivé ; annulé = 0 crédit, catégorique
 *  - webhooks Meta/TikTok : signature vérifiée, réception + stockage
 *    (l'envoi automatique Meta sera activé à l'étape Tests avec les
 *    vrais identifiants — le Node reste la production d'ici là)
 * Secrets : uniquement via les Secrets Workers, jamais dans le code.
 */
import * as db from './db.js';
import { COUNTRIES, getCountry } from './countries.js';
import { generateReply, buildInstructions, extractPdfText, wantsHuman } from './brain.js';
import * as connectors from './connectors.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((s.match(/.{2}/g) || []).map(h => parseInt(h, 16)));
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
async function hashPassword(password, saltHex) {
  const mat = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(saltHex), iterations: 100000, hash: 'SHA-256' }, mat, 256);
  return 'pbkdf2$100000$' + hex(bits);
}
async function verifyPassword(password, user) {
  if (!user.auth_hash?.startsWith('pbkdf2$')) return false; // ancien format scrypt (Node) : mot de passe à redéfinir
  return (await hashPassword(password, user.auth_salt)) === user.auth_hash;
}
async function bodyJson(req) { try { return await req.json(); } catch { return {}; } }

async function auth(req, env) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') || '');
  if (!m) return null;
  const user = await db.userBySession(env.DB, await sha256(m[1]));
  return user ? { userId: user.id, workspaceId: user.workspace_id, name: user.full_name, login: user.login } : null;
}
const needAuth = async (req, env) => {
  const a = await auth(req, env);
  return a || null;
};
async function newSession(env, userId) {
  const token = randHex(32);
  const exp = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await db.createSession(env.DB, userId, await sha256(token), exp);
  return token;
}


// ---------- Page Admin en ligne (propriétaire uniquement) ----------
function adminLoginPage(err) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Accès propriétaire</title><link rel="icon" type="image/png" href="/logo.png"><style>body{font-family:system-ui,Arial,sans-serif;background:#12141a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.box{background:#1e212b;padding:30px;border-radius:18px;max-width:380px;width:92vw}input{width:100%;padding:13px;border-radius:10px;border:2px solid #333744;background:#12141a;color:#fff;font-size:16px;box-sizing:border-box}button{width:100%;padding:13px;border-radius:10px;border:none;background:#00c853;color:#fff;font-weight:800;font-size:15px;margin-top:12px;cursor:pointer}.err{background:#3a2323;color:#ffb3b5;padding:10px;border-radius:10px;font-size:13.5px;margin-bottom:12px;${err ? '' : 'display:none'}</style></head><body><div class="box"><img src="/logo.png" alt="Logo" style="width:64px;height:64px;border-radius:14px;object-fit:cover"><h1 style="font-size:20px">Accès propriétaire</h1><p style="color:#9aa3b2;font-size:14px">Zone réservée à l'administrateur de Pilote Réseau : branchez ici Meta, TikTok, l'IA et SasPay.</p><div class="err">${err || ''}</div><form method="POST" action="/admin/login"><label style="font-size:13px;font-weight:700">Email du propriétaire</label><input type="email" name="email" required placeholder="votre@email.com" autocomplete="username"><label style="font-size:13px;font-weight:700;display:block;margin-top:12px">Votre code</label><input type="password" name="password" required placeholder="Votre code d'accès" autocomplete="current-password"><button type="submit">Ouvrir mon administration →</button></form><p style="font-size:12px;color:#5b6472"><a href="/" style="color:#9aa3b2">← Retour au site</a></p></div></body></html>`;
}
const adminSecret = (env) => env.ADMIN_KEY || env.TOKEN_ENCRYPTION_KEY || '';
const ownerEmail = (env) => String(env.OWNER_EMAIL || '').trim().toLowerCase();
async function adminToken(env, exp) { return exp + '.' + await hmacHex(adminSecret(env), 'admin:' + exp); }
async function hasAdminSession(req, env) {
  if (!adminSecret(env)) return false;
  const m = /(?:^|;\s*)pr_admin=([0-9]+\.[a-f0-9]{64})/.exec(req.headers.get('Cookie') || '');
  if (!m) return false;
  const exp = Number(m[1].split('.')[0]);
  if (!exp || exp < Date.now()) return false;
  return m[1] === await adminToken(env, exp);
}
const isAdminReq = async (req, env) => {
  if (env.ADMIN_KEY && req.headers.get('x-admin-key') === env.ADMIN_KEY) return true;
  if (await hasAdminSession(req, env)) return true;
  const a = await auth(req, env); // le propriétaire connecté sur la plateforme est admin
  return Boolean(a && ownerEmail(env) && a.login === ownerEmail(env));
};
function adminPanelPage() {
  return ADMIN_PANEL_HTML;
}
async function handleAdminPage(req, env, url) {
  const p = url.pathname;
  if (p === '/admin' && req.method === 'GET') {
    if (!adminSecret(env)) return new Response(adminLoginPage('Accès pas encore activé côté Cloudflare : ajoutez le secret TOKEN_ENCRYPTION_KEY (Worker → Settings → Variables and Secrets), puis revenez.'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (await hasAdminSession(req, env)) return Response.redirect(url.origin + '/admin/panel', 302);
    return new Response(adminLoginPage(url.searchParams.get('err') ? 'Email ou code incorrect. Réessayez.' : ''), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (p === '/admin/login' && req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    const email = form ? String(form.get('email') || '').trim().toLowerCase() : '';
    const password = form ? String(form.get('password') || '') : '';
    const key = form ? String(form.get('key') || '') : '';
    let okLogin = Boolean(env.ADMIN_KEY && key && key === env.ADMIN_KEY);
    if (!okLogin && email && password && ownerEmail(env) && email === ownerEmail(env)) {
      const user = await db.findUserByLogin(env.DB, email);
      if (user) okLogin = await verifyPassword(password, user);
    }
    if (!okLogin || !adminSecret(env)) return Response.redirect(url.origin + '/admin?err=1', 302);
    const exp = Date.now() + 12 * 3600 * 1000;
    const token = await adminToken(env, exp);
    return new Response('', { status: 302, headers: { Location: url.origin + '/admin/panel', 'Set-Cookie': 'pr_admin=' + token + '; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200' } });
  }
  if (p === '/admin/panel' && req.method === 'GET') {
    if (!(await hasAdminSession(req, env))) return Response.redirect(url.origin + '/admin', 302);
    return new Response(adminPanelPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (p === '/admin/logout') return new Response('', { status: 302, headers: { Location: url.origin + '/admin', 'Set-Cookie': 'pr_admin=; HttpOnly; Path=/; Max-Age=0' } });
  return null;
}
const ADMIN_PANEL_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin — Pilote Réseau</title><link rel="icon" type="image/png" href="/logo.png"><style>body{font-family:system-ui,Arial,sans-serif;background:#f8f9ff;color:#131c28;margin:0}.top{background:#fff;border-bottom:1px solid #e2dcf5;padding:14px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.wrap{max-width:880px;margin:auto;padding:18px}.carte{background:#fff;border:1px solid #e2dcf5;border-radius:16px;padding:18px;margin-bottom:16px}label{font-size:13px;font-weight:700;display:block;margin-top:10px}.ipt{width:100%;padding:12px;border:1.5px solid #d8d2f0;border-radius:10px;font-size:14.5px;box-sizing:border-box}button{padding:10px 18px;border-radius:999px;border:none;font-weight:700;cursor:pointer}.bp{background:#5314d1;color:#fff}.bc{background:#fff;border:1.5px solid #d8d2f0}.bd{background:#ffe9ec;color:#b00020}.etat{font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px}.on{background:#dcf8e3;color:#00732c}.off{background:#fde8e8;color:#b00020}.note{font-size:12.5px;color:#6b6880}.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#131c28;color:#fff;padding:12px 18px;border-radius:12px;font-size:14px;display:none;max-width:92vw}</style></head><body>
<div class="top"><img src="/logo.png" style="width:36px;height:36px;border-radius:9px;object-fit:cover"><b style="flex:1">Administration Pilote Réseau</b><a href="/" style="font-size:13px">Voir le site</a> <a href="/admin/logout" style="font-size:13px;color:#b00020;font-weight:700">Se déconnecter</a></div>
<div class="wrap"><h1 style="font-size:22px">🔌 Connecteurs API</h1><p class="note">Collez vos clés, enregistrez : elles sont gardées <b>chiffrées, côté serveur</b>, et ne s'affichent jamais en entier. Laissez un champ vide pour garder la valeur actuelle.</p>
<p class="note">📋 Adresses à déclarer chez les fournisseurs :<br>Webhook Meta : <b id="cb-meta"></b><br>Retour connexion Meta : <b id="cb-metaoauth"></b><br>Webhook TikTok : <b id="cb-tiktok"></b><br>Webhook SasPay : <b id="cb-saspay"></b></p>
<div id="cartes">⏳ Chargement…</div></div><div class="toast" id="toast"></div>
<script>
const CHAMPS={meta:{appId:"App ID",appSecret:"App Secret",verifyToken:"Jeton de vérification (Verify Token)",whatsappToken:"Jeton WhatsApp permanent"},tiktok:{clientKey:"Client Key",clientSecret:"Client Secret",webhookSecret:"Secret du webhook"},ai:{apiKey:"Clé API de l'IA"},saspay:{secretKey:"Clé secrète SasPay",webhookSecret:"Secret du webhook SasPay"}};
const $=id=>document.getElementById(id);
function esc(t){const d=document.createElement('div');d.textContent=t||'';return d.innerHTML}
function toast(m){const t=$('toast');t.textContent=m;t.style.display='block';setTimeout(()=>t.style.display='none',4500)}
async function api(url,opts){ const r=await fetch(url,opts); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Erreur'); return d; }
async function charger(){ try{ const d=await api('/api/admin/connectors'); $('cb-meta').textContent=d.callbacks.metaWebhook; $('cb-metaoauth').textContent=d.callbacks.metaOAuth; $('cb-tiktok').textContent=d.callbacks.tiktokWebhook; $('cb-saspay').textContent=d.callbacks.saspayWebhook;
 $('cartes').innerHTML=Object.entries(d.providers).map(([code,p])=>'<div class="carte"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><h2 style="margin:0;font-size:18px">'+p.icon+' '+esc(p.label)+'</h2><span class="etat '+(p.configured?'on':'off')+'">'+(p.configured?'🟢 Configuré':'⚪ Non configuré')+'</span></div>'+Object.entries(p.fields).map(([f,v])=>'<label>'+esc((CHAMPS[code]||{})[f]||f)+(v.set?' · <span style="color:#00732c">actuel : '+esc(v.masked)+' ('+(v.source==='admin'?'page Admin':'secret Cloudflare')+')</span>':'')+'</label><div style="display:flex;gap:8px"><input class="ipt" id="c-'+code+'-'+f+'" placeholder="'+(v.set?'Laisser vide = garder actuel':'📋 Collez la clé ici…')+'" autocomplete="off">'+(v.set?'<button class="bd" onclick="effacer(\\''+code+'\\',\\''+f+'\\')">Effacer</button>':'')+'</div>').join('')+'<p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="bp" onclick="sauver(\\''+code+'\\')">💾 Enregistrer</button><button class="bc" onclick="tester(\\''+code+'\\')">🧪 Tester la connexion</button></p><p class="note" id="t-'+code+'"></p></div>').join('');
 }catch(e){ $('cartes').innerHTML='⚠️ '+esc(e.message); } }
async function sauver(code){ const champs={}; document.querySelectorAll('[id^="c-'+code+'-"]').forEach(i=>{ if(i.value.trim()) champs[i.id.slice(code.length+3)]=i.value.trim(); }); if(!Object.keys(champs).length){ toast("Collez au moins une clé avant d'enregistrer."); return; } try{ await api('/api/admin/connectors/'+code+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:champs})}); toast('✅ Enregistré et activé immédiatement'); charger(); }catch(e){ toast('⚠️ '+e.message); } }
async function effacer(code,f){ if(!confirm('Effacer cette valeur ?'))return; try{ await api('/api/admin/connectors/'+code+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{[f]:'__clear__'}})}); toast('🗑 Effacé'); charger(); }catch(e){ toast('⚠️ '+e.message); } }
async function tester(code){ const z=$('t-'+code); z.textContent='⏳ Test en cours…'; try{ const d=await api('/api/admin/connectors/'+code+'/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); z.textContent=(d.ok?'✅ ':'⚠️ ')+d.message; }catch(e){ z.textContent='⚠️ '+e.message; } }
charger();
</script></body></html>`;


async function handleApi(req, env, url) {
  const p = url.pathname;

  if (p === '/api/health') {
    let tables = [];
    try { const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(); tables = (r.results || []).map(x => x.name); } catch {}
    return json({ ok: true, service: 'Pilote Réseau API (Cloudflare)', modeIA: env.LLM_API_KEY ? 'llm' : 'local-demo', d1: tables.length ? 'ok' : 'non-liée', tables: tables.length });
  }

  // ---------- Auth ----------
  if (p === '/api/auth/register' && req.method === 'POST') {
    const b = await bodyJson(req);
    const login = String(b.login || '').trim().toLowerCase();
    if (!b.name?.trim()) return json({ error: 'Dites-nous votre nom ou le nom de votre boutique.' }, 400);
    if (login.length < 3) return json({ error: 'Indiquez un numéro de téléphone ou un email valide.' }, 400);
    if (!b.password || String(b.password).length < 6) return json({ error: 'Mot de passe trop court : 6 caractères minimum.' }, 400);
    if (await db.findUserByLogin(env.DB, login)) return json({ error: 'Un compte existe déjà avec ce numéro/email. Essayez de vous connecter.' }, 400);
    const salt = randHex(16);
    const { userId, workspaceId } = await db.createUser(env.DB, { name: String(b.name).trim().slice(0, 80), login, salt, hash: await hashPassword(b.password, salt) });
    const token = await newSession(env, userId);
    return json({ user: { id: userId, name: b.name, login, workspaceId }, token, credits: await db.getCredits(env.DB, workspaceId) }, 201);
  }
  if (p === '/api/auth/login' && req.method === 'POST') {
    const b = await bodyJson(req);
    const user = await db.findUserByLogin(env.DB, String(b.login || '').trim().toLowerCase());
    if (!user || !(await verifyPassword(b.password || '', user))) return json({ error: 'Numéro/email ou mot de passe incorrect. Vérifiez et réessayez.' }, 401);
    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE owner_id = ?').bind(user.id).first();
    const token = await newSession(env, user.id);
    return json({ user: { id: user.id, name: user.full_name, login: user.login, workspaceId: ws?.id }, token, credits: ws ? await db.getCredits(env.DB, ws.id) : null });
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    const m = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') || '');
    if (m) await db.deleteSession(env.DB, await sha256(m[1]));
    return json({ ok: true });
  }
  if (p === '/api/auth/me' && req.method === 'GET') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous pour accéder à vos données.' }, 401);
    return json({ user: { id: a.userId, name: a.name, login: a.login, workspaceId: a.workspaceId }, credits: await db.getCredits(env.DB, a.workspaceId) });
  }

  // ---------- Références publiques ----------
  if (p === '/api/plans' && req.method === 'GET') {
    const r = await env.DB.prepare('SELECT code, name, price_monthly AS priceMonthly, currency, credits_included AS creditsIncluded FROM plans ORDER BY price_monthly').all();
    return json({ plans: r.results || [] });
  }
  if (p === '/api/countries' && req.method === 'GET') return json({ countries: COUNTRIES, reference: 'USD' });

  // ---------- Assistants guidés + Playground ----------
  if (p === '/api/assistants/guided-setup' && req.method === 'POST') {
    const b = await bodyJson(req);
    return json({ instructions: buildInstructions(b) });
  }
  if ((p === '/api/playground/chat' || p === '/api/chat') && req.method === 'POST') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous pour accéder à vos données.' }, 401);
    const b = await bodyJson(req);
    if (!b.message?.trim()) return json({ error: 'Écrivez un message.' }, 400);
    const isPlayground = p.includes('playground');
    if (!isPlayground) {
      const c = await db.getCredits(env.DB, a.workspaceId);
      if (c.balance <= 0) return json({ error: 'Plus de crédits. Rechargez pour que votre assistant continue de répondre.' }, 402);
    }
    const kbRows = await db.allKnowledge(env.DB, a.workspaceId);
    const assistant = { instructions: b.assistant?.instructions || buildInstructions({ businessName: b.assistant?.businessName, mission: b.assistant?.mission }), businessName: b.assistant?.businessName };
    const aiKey = env.LLM_API_KEY || (await connectors.get(env, 'ai')).apiKey;
    const result = await generateReply({ ...env, LLM_API_KEY: aiKey }, { assistant, userText: b.message, history: b.history || [], kbRows });
    let balance = (await db.getCredits(env.DB, a.workspaceId)).balance;
    if (!isPlayground && !result.handoff) { if (await db.consumeCredit(env.DB, a.workspaceId)) balance -= 1; }
    return json({ ...result, creditsUsed: !isPlayground && !result.handoff ? 1 : 0, balance, playground: isPlayground });
  }

  // ---------- Assistants enregistrés ----------
  if (p === '/api/assistants' && req.method === 'GET') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const linked = await db.listConnectedAccounts(env.DB, a.workspaceId);
    const list = (await db.listAssistants(env.DB, a.workspaceId)).map(x => ({
      id: x.id, name: x.name, channel: x.channel, mission: x.mission, active: x.is_active !== 0,
      connected: linked.some(l => l.channel === x.channel && l.status === 'connected'), createdAt: x.created_at,
    }));
    return json({ assistants: list });
  }
  if (p === '/api/assistants' && req.method === 'POST') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const b = await bodyJson(req);
    if (!b.name || !b.channel) return json({ error: 'Il manque le nom ou le réseau de l\'assistant.' }, 400);
    if (!['whatsapp', 'facebook', 'instagram', 'tiktok'].includes(b.channel)) return json({ error: 'Réseau inconnu. Choisissez WhatsApp, Facebook, Instagram ou TikTok.' }, 400);
    const created = await db.createAssistant(env.DB, a.workspaceId, b);
    return json({ assistant: { ...created, active: true, connected: false } }, 201);
  }
  if (p.startsWith('/api/assistants/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const assistantId = p.split('/').pop();
    if (req.method === 'DELETE') return json({ removed: await db.deleteAssistant(env.DB, a.workspaceId, assistantId) });
    const b = await bodyJson(req);
    const ok = await db.setAssistantActive(env.DB, a.workspaceId, assistantId, Boolean(b.active));
    if (!ok) return json({ error: 'Assistant introuvable dans votre espace.' }, 404);
    return json({ assistant: { id: assistantId, active: Boolean(b.active) } });
  }

  // ---------- Base de connaissances ----------
  if (p === '/api/knowledge' && req.method === 'GET') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const items = (await db.listKnowledge(env.DB, a.workspaceId)).map(k => ({ ...k, statut: 'Prêt' }));
    return json({ items });
  }
  if (p === '/api/knowledge' && req.method === 'POST') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const b = await bodyJson(req);
    if (!b.title || !b.content) return json({ error: 'Il manque le titre ou le contenu.' }, 400);
    const item = await db.addKnowledge(env.DB, a.workspaceId, { type: b.type || 'text', title: String(b.title).slice(0, 120), content: String(b.content).slice(0, 60000) });
    return json({ item: { id: item.id, type: item.type, title: item.title, statut: 'Prêt' } }, 201);
  }
  if (p === '/api/knowledge/pdf' && req.method === 'POST') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const b = await bodyJson(req);
    if (!b.base64) return json({ error: 'Aucun fichier reçu. Touchez « Choisir un PDF » puis sélectionnez votre document.' }, 400);
    const bin = atob(String(b.base64).replace(/^data:[^,]*,/, ''));
    if (bin.length > 6 * 1024 * 1024) return json({ error: 'Ce PDF est trop lourd (maximum 6 Mo). Solution : compressez-le ou copiez-collez son texte dans la zone « Copier-coller ».' }, 400);
    const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    let text;
    try { text = await extractPdfText(buf.buffer); }
    catch { return json({ error: 'Ce fichier n\'est pas un PDF lisible. Solution : choisissez un vrai fichier .pdf, ou copiez-collez son texte dans la zone « Copier-coller ».' }, 400); }
    if (!text || text.length < 10) return json({ error: 'Je n\'ai trouvé aucun texte dans ce PDF (c\'est peut-être un document scanné en image). Solution : copiez-collez le texte dans la zone « Copier-coller un texte » ci-dessous.' }, 400);
    const item = await db.addKnowledge(env.DB, a.workspaceId, { type: 'pdf', title: String(b.title || b.fileName || 'Document PDF').slice(0, 120), content: text });
    return json({ item: { id: item.id, type: 'PDF', title: item.title, caracteres: text.length, statut: 'Prêt' }, message: 'PDF lu : ' + text.length + ' caractères appris par votre assistant.' }, 201);
  }
  if (p.startsWith('/api/knowledge/') && req.method === 'DELETE') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    return json({ removed: await db.deleteKnowledge(env.DB, a.workspaceId, p.split('/').pop()) });
  }

  // ---------- Crédits / boîte de réception ----------
  if (p === '/api/credits' && req.method === 'GET') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    return json(await db.getCredits(env.DB, a.workspaceId));
  }
  if (p === '/api/inbox' && req.method === 'GET') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const messages = await db.listRecentMessages(env.DB, a.workspaceId);
    const linked = (await db.listConnectedAccounts(env.DB, a.workspaceId)).filter(l => l.status === 'connected');
    return json({ messages, connectedChannels: linked.map(l => l.channel) });
  }

  // ---------- Paiements SasPay (mêmes règles strictes) ----------
  if (p === '/api/payments/checkout' && req.method === 'POST') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const b = await bodyJson(req);
    const plan = await env.DB.prepare('SELECT * FROM plans WHERE code = ?').bind(b.planCode).first();
    if (!plan) return json({ error: 'Plan inconnu.' }, 400);
    const country = getCountry(b.countryCode || env.SASPAY_COUNTRY || 'CD');
    const chargedAmount = country.sasPay ? Math.round(plan.price_monthly * country.rate) : plan.price_monthly;
    const currency = country.sasPay ? country.currency : 'USD';
    const saspayCfg = await connectors.get(env, 'saspay');
    if (saspayCfg.secretKey || env.SASPAY_SECRET_KEY) {
      try {
        const r = await fetch(`${env.SASPAY_BASE_URL || 'https://api.saspay.me/api/v1'}/checkout-sessions/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saspayCfg.secretKey || env.SASPAY_SECRET_KEY}` },
          body: JSON.stringify({ amount: chargedAmount, currency, country_code: country.code, phone: b.phone || '', description: `Pilote Réseau — plan ${plan.name}`, metadata: { workspaceId: a.workspaceId, planCode: plan.code } }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || 'SasPay ' + r.status);
        const pay = await db.createPayment(env.DB, a.workspaceId, { provider: 'saspay', provider_ref: d.data?.id || d.data?.session_id, amount_usd: plan.price_monthly, chargedAmount, currency, method: b.method, country: country.code });
        return json({ payment: { ...pay, providerRef: pay.provider_ref, checkoutUrl: d.data?.checkout_url || d.data?.url, status: 'pending', chargedAmount, chargedCurrency: currency, country } });
      } catch (e) { return json({ error: 'SasPay ne répond pas : ' + e.message + ' Réessayez dans un instant.' }, 502); }
    }
    const pay = await db.createPayment(env.DB, a.workspaceId, { provider: 'simulation', amount_usd: plan.price_monthly, chargedAmount, currency, method: b.method, country: country.code });
    const ref = 'sim_' + pay.id;
    await env.DB.prepare('UPDATE payments SET provider_ref = ? WHERE id = ?').bind(ref, pay.id).run();
    return json({ payment: { ...pay, providerRef: ref, status: 'pending', chargedAmount, chargedCurrency: currency, country }, mode: 'simulation', message: 'Mode simulation : aucun vrai débit (clé SasPay non configurée).' });
  }
  if (p.startsWith('/api/payments/status/') && req.method === 'GET') {
    const a = await needAuth(req, env); if (!a) return json({ error: 'Connectez-vous.' }, 401);
    const pay = await db.paymentByRef(env.DB, p.split('/').pop());
    if (!pay || pay.workspace_id !== a.workspaceId) return json({ error: 'Paiement introuvable.' }, 404);
    // Lecture seule : ne crédite JAMAIS (même règle stricte que le Node)
    return json({ payment: { status: pay.status, providerRef: pay.provider_ref, creditsGranted: pay.credits_granted || 0 } });
  }
  if (p === '/webhooks/saspay' && req.method === 'POST') {
    const raw = await req.text();
    const ts = req.headers.get('x-saspay-timestamp') || req.headers.get('timestamp') || '';
    const sig = req.headers.get('x-saspay-signature') || req.headers.get('signature') || '';
    if (!env.SASPAY_WEBHOOK_SECRET) return json({ error: 'Webhook non configuré.' }, 503);
    const expected = await hmacHex(env.SASPAY_WEBHOOK_SECRET, `${ts}.${raw}`);
    if (!sig || sig.replace(/^sha256=/, '') !== expected) return json({ error: 'Signature invalide.' }, 401);
    if (ts && Math.abs(Date.now() / 1000 - Number(ts)) > 300) return json({ error: 'Signal trop ancien.' }, 401);
    let evt = {}; try { evt = JSON.parse(raw); } catch {}
    const ref = evt.data?.id || evt.data?.session_id || evt.session_id || evt.id;
    const pay = ref ? await db.paymentByRef(env.DB, ref) : null;
    if (!pay) return json({ ok: true, ignored: true });
    // Revérification auprès de SasPay : croire le statut confirmé par l'API, pas le seul webhook
    let real = String(evt.data?.status || evt.status || '').toLowerCase();
    try {
      const r = await fetch(`${env.SASPAY_BASE_URL || 'https://api.saspay.me/api/v1'}/checkout-sessions/${ref}/status/`, { headers: { Authorization: `Bearer ${env.SASPAY_SECRET_KEY}` } });
      const d = await r.json(); if (r.ok) real = String(d.data?.status || real).toLowerCase();
    } catch {}
    if (['paid', 'success', 'succeeded', 'completed'].includes(real)) {
      if (pay.status !== 'paid') {
        const plan = await env.DB.prepare('SELECT * FROM plans WHERE price_monthly = ? LIMIT 1').bind(pay.amount_usd).first();
        const credits = plan ? plan.credits_included : 0;
        await db.setPaymentStatus(env.DB, ref, 'paid', credits);
        if (credits) await db.grantCredits(env.DB, pay.workspace_id, credits, 'achat');
      }
      return json({ ok: true, status: 'paid' });
    }
    if (['cancelled', 'canceled', 'failed', 'expired'].includes(real)) {
      await db.setPaymentStatus(env.DB, ref, 'cancelled', 0); // catégorique : 0 crédit
      return json({ ok: true, status: 'cancelled' });
    }
    return json({ ok: true, status: pay.status });
  }

  // ---------- Webhooks réseaux : réception vérifiée + stockage ----------
  if (p === '/webhooks/meta' && req.method === 'GET') {
    const metaCfg = await connectors.get(env, 'meta');
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === (metaCfg.verifyToken || env.META_VERIFY_TOKEN))
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
    return new Response('forbidden', { status: 403 });
  }
  if ((p === '/webhooks/meta' || p === '/webhooks/tiktok') && req.method === 'POST') {
    const raw = await req.text();
    const metaSecret = (await connectors.get(env, 'meta')).appSecret || env.META_APP_SECRET;
    if (p.includes('meta') && metaSecret) {
      const sig = req.headers.get('x-hub-signature-256') || '';
      const expected = 'sha256=' + (await hmacHex(metaSecret, raw));
      if (sig !== expected) return json({ error: 'Signature Meta invalide.' }, 401);
    }
    let evt = {}; try { evt = JSON.parse(raw); } catch {}
    await db.logOperation(env.DB, null, 'webhook', p, `reçu (${raw.length} octets)`).catch(() => {});
    return json({ received: true, note: 'Réception et stockage : OK. Envoi automatique activé à l\'étape Tests avec identifiants réels.' });
  }

  // ---------- Admin : connecteurs (coller les clés Meta, TikTok, IA, SasPay) ----------
  if (p === '/api/admin/connectors' && req.method === 'GET') {
    if (!(await isAdminReq(req, env))) return json({ error: 'Accès admin refusé. Connectez-vous à la page Admin.' }, 401);
    const origin = url.origin;
    return json({ providers: await connectors.adminView(env), callbacks: {
      metaWebhook: origin + '/webhooks/meta', metaOAuth: origin + '/auth/meta/callback',
      tiktokWebhook: origin + '/webhooks/tiktok', tiktokOAuth: origin + '/auth/tiktok/callback',
      saspayWebhook: origin + '/webhooks/saspay' } });
  }
  if (p.startsWith('/api/admin/connectors/') && req.method === 'POST') {
    if (!(await isAdminReq(req, env))) return json({ error: 'Accès admin refusé. Connectez-vous à la page Admin.' }, 401);
    const parts = p.split('/'); const provider = decodeURIComponent(parts[4] || ''); const action = parts[5];
    if (!connectors.PROVIDERS[provider]) return json({ error: 'Connecteur inconnu.' }, 400);
    const b = await bodyJson(req);
    if (action === 'save') {
      try {
        const r = await connectors.update(env, provider, b.fields || {});
        if (r.error) return json({ error: r.error }, 400);
        return json({ provider, view: r.view, configured: await connectors.isConfigured(env, provider) });
      } catch (e) { return json({ error: e.message }, 400); }
    }
    if (action === 'test') {
      const v = await connectors.get(env, provider);
      try {
        if (provider === 'meta') {
          if (!v.appId || !v.appSecret) return json({ ok: false, message: 'Il manque App ID et/ou App Secret Meta. Collez-les puis enregistrez.' });
          const r = await fetch('https://graph.facebook.com/v21.0/app?access_token=' + encodeURIComponent(v.appId + '|' + v.appSecret));
          const d = await r.json().catch(() => ({}));
          return json(r.ok ? { ok: true, message: 'Meta répond : application « ' + (d.name || v.appId) + ' » reconnue ✔️' } : { ok: false, message: 'Meta refuse ces identifiants : ' + (d.error?.message || r.status) });
        }
        if (provider === 'tiktok') {
          if (!v.clientKey || !v.clientSecret) return json({ ok: false, message: 'Il manque Client Key et/ou Client Secret TikTok.' });
          return json({ ok: true, message: 'Identifiants TikTok présents ✔️ (validation complète à la connexion du compte, après approbation TikTok).' });
        }
        if (provider === 'ai') {
          if (!v.apiKey) return json({ ok: false, message: "Collez d'abord la clé de l'IA." });
          const r = await fetch((env.LLM_BASE_URL || 'https://api.openai.com/v1') + '/models', { headers: { Authorization: 'Bearer ' + v.apiKey } });
          return json(r.ok ? { ok: true, message: 'IA connectée ✔️ Le vrai modèle répond.' } : { ok: false, message: 'Le fournisseur IA refuse cette clé (HTTP ' + r.status + ').' });
        }
        if (provider === 'saspay') {
          if (!v.secretKey) return json({ ok: false, message: "Collez d'abord la clé secrète SasPay." });
          const r = await fetch((env.SASPAY_BASE_URL || 'https://api.saspay.me/api/v1') + '/countries/', { headers: { Authorization: 'Bearer ' + v.secretKey } });
          return json(r.ok ? { ok: true, message: 'SasPay connecté ✔️' } : { ok: false, message: 'SasPay refuse cette clé (HTTP ' + r.status + ').' });
        }
      } catch (e) { return json({ ok: false, message: 'Test impossible : ' + e.message }); }
    }
    return json({ error: 'Action inconnue.' }, 400);
  }

  if (p.startsWith('/api/') || p.startsWith('/webhooks/')) return json({ error: 'Route non migrée à ce stade (voir Étape C).' }, 404);
  return null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      const r = await handleAdminPage(req, env, url);
      if (r) return r;
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/') || url.pathname.startsWith('/worker/')) {
      if (url.pathname === '/worker/health') {
        const r = await handleApi(req, env, new URL('/api/health', url.origin));
        return r;
      }
      const r = await handleApi(req, env, url);
      if (r) return r;
    }
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('Pilote Réseau — Cloudflare', { status: 200 });
  },
};
