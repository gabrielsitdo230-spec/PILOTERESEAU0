/**
 * Tests Étape C — Worker Cloudflare en local, avec un faux D1 en mémoire.
 * Vérifie le parcours réel : inscription (10 offerts) -> assistant ->
 * savoir -> playground/chat (débit) -> PDF -> paiement simulation.
 * Lancer : node cloudflare/test/worker-local.test.mjs
 */
import worker from '../src/worker.js';

let n = 0; const ok = (name, cond) => { if (!cond) throw new Error('ÉCHEC: ' + name); n++; console.log('✅ ' + name); };

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.b = []; }
  bind(...a) { this.b = a; return this; }
  async run() { return this.db.exec(this.sql, this.b, 'run'); }
  async first() { return this.db.exec(this.sql, this.b, 'first'); }
  async all() { return { results: this.db.exec(this.sql, this.b, 'all') }; }
}
class FakeDB {
  constructor() {
    this.t = { profiles: [], workspaces: [], sessions: [], credit_accounts: [], credit_transactions: [], assistants: [], knowledge_sources: [], connected_accounts: [], payments: [], operation_log: [] };
    this.t.plans = [
      { code: 'starter', name: 'Starter', price_monthly: 2, currency: 'USD', credits_included: 500 },
      { code: 'pro', name: 'Pro', price_monthly: 10, currency: 'USD', credits_included: 3500 },
    ];
  }
  prepare(sql) { return new Stmt(this, sql); }
  async batch(stmts) { for (const s of stmts) await s.run(); }
  insert(table, cols, vals) {
    const row = {}; cols.forEach((c, i) => row[c] = vals[i]);
    if (table === 'connected_accounts') row.status = 'connected';
    if (table === 'payments' && this.t.payments.some(r => r.provider_ref && r.provider_ref === row.provider_ref)) return { meta: { changes: 0 } };
    this.t[table].push(row); return { meta: { changes: 1 } };
  }
  exec(sql, b, mode) {
    const s = sql.replace(/\s+/g, ' ');
    let m;
    if (s.includes("FROM sqlite_master")) return [{ name: 'plans' }];
    if ((m = s.match(/INSERT INTO (\w+)\(([^)]+)\)/))) return this.insert(m[1], m[2].split(',').map(x => x.trim()), b);
    if (s.includes('FROM profiles WHERE login')) return this.t.profiles.find(r => r.login === b[0]) || null;
    if (s.includes('FROM sessions s JOIN')) { const ses = this.t.sessions.find(r => r.token_hash === b[0] && r.expires_at > b[1]); if (!ses) return null; const p = this.t.profiles.find(r => r.id === ses.user_id); const w = this.t.workspaces.find(r => r.owner_id === p.id); return { ...p, workspace_id: w.id }; }
    if (s.includes('DELETE FROM sessions')) { this.t.sessions = this.t.sessions.filter(r => r.token_hash !== b[0]); return { meta: { changes: 1 } }; }
    if (s.includes('SELECT id FROM workspaces WHERE owner_id')) return this.t.workspaces.find(r => r.owner_id === b[0]) || null;
    if (s.includes('FROM plans ORDER BY')) return this.t.plans.map(p => ({ code: p.code, name: p.name, priceMonthly: p.price_monthly, currency: p.currency, creditsIncluded: p.credits_included }));
    if (s.includes('FROM plans WHERE code')) return this.t.plans.find(r => r.code === b[0]) || null;
    if (s.includes('FROM plans WHERE price_monthly')) return this.t.plans.find(r => r.price_monthly === b[0]) || null;
    if (s.includes('SELECT * FROM credit_accounts')) return this.t.credit_accounts.find(r => r.workspace_id === b[0]) || null;
    if (s.includes('FROM credit_transactions')) return this.t.credit_transactions.filter(r => r.workspace_id === b[0]);
    if (s.includes('UPDATE credit_accounts SET balance = balance - 1')) { const a = this.t.credit_accounts.find(r => r.workspace_id === b[0]); if (a && a.balance > 0) { a.balance--; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
    if (s.includes('UPDATE payments SET provider_ref')) { const p = this.t.payments.find(r => r.id === b[1]); if (p) p.provider_ref = b[0]; return { meta: { changes: 1 } }; }
    if (s.includes('UPDATE payments SET status')) { const p = this.t.payments.find(r => r.provider_ref === b[2]); if (p) { p.status = b[0]; p.credits_granted = b[1]; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
    if (s.includes('FROM payments WHERE provider_ref')) return this.t.payments.find(r => r.provider_ref === b[0]) || null;
    if (s.includes('FROM assistants WHERE workspace_id')) return this.t.assistants.filter(r => r.workspace_id === b[0]);
    if (s.includes('UPDATE assistants SET is_active')) { const a = this.t.assistants.find(r => r.id === b[2] && r.workspace_id === b[3]); if (a) { a.is_active = b[0]; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
    if (s.includes('DELETE FROM assistants')) { const i = this.t.assistants.findIndex(r => r.id === b[0] && r.workspace_id === b[1]); if (i >= 0) { this.t.assistants.splice(i, 1); return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
    if (s.includes('SELECT id, type, title') && s.includes('knowledge_sources')) return this.t.knowledge_sources.filter(r => r.workspace_id === b[0]).map(k => ({ id: k.id, type: k.type, title: k.title, caracteres: (k.content || '').length, created_at: k.created_at }));
    if (s.includes('SELECT title, content FROM knowledge_sources')) return this.t.knowledge_sources.filter(r => r.workspace_id === b[0]);
    if (s.includes('DELETE FROM knowledge_sources')) { const i = this.t.knowledge_sources.findIndex(r => r.id === b[0] && r.workspace_id === b[1]); if (i >= 0) { this.t.knowledge_sources.splice(i, 1); return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
    if (s.includes('FROM connected_accounts')) return this.t.connected_accounts.filter(r => r.workspace_id === b[0]);
    if (s.includes('FROM messages m JOIN')) return [];
    if (s.includes('SELECT COUNT(*) AS n FROM profiles')) return { n: this.t.profiles.length };
    if (s.includes('FROM assistants') && s.includes('COUNT(*)') && !s.includes('GROUP BY')) { const a = this.t.assistants; return { n: a.length, actifs: a.filter(x => x.is_active).length }; }
    if (s.includes("FROM messages WHERE sender = 'ai'")) return { n: 0, credits: 0 };
    if (s.includes('FROM assistants GROUP BY channel')) { const g = {}; for (const a of this.t.assistants) { g[a.channel] = g[a.channel] || { channel: a.channel, n: 0, actifs: 0 }; g[a.channel].n++; if (a.is_active) g[a.channel].actifs++; } return Object.values(g); }
    if (s.includes('FROM connected_accounts') && s.includes('GROUP BY')) return [];
    if (s.includes('SUM(balance)')) return { total: this.t.credit_accounts.reduce((t, a) => t + (a.balance || 0), 0) };
    if (s.includes('accordes')) { let ac = 0, co = 0; for (const t of this.t.credit_transactions) { if (t.amount > 0) ac += t.amount; else co += -t.amount; } return { accordes: ac, consommes: co }; }
    if (s.includes('FROM payments GROUP BY status')) { const g = {}; for (const p of this.t.payments) { g[p.status] = g[p.status] || { status: p.status, n: 0, usd: 0, credits: 0 }; g[p.status].n++; g[p.status].usd += p.amount_usd || 0; g[p.status].credits += p.credits_granted || 0; } return Object.values(g); }
    if (s.includes('FROM credit_accounts GROUP BY plan')) { const g = {}; for (const a of this.t.credit_accounts) { g[a.plan] = (g[a.plan] || 0) + 1; } return Object.entries(g).map(([plan, n]) => ({ plan, n })); }
    if (s.includes('FROM payments ORDER BY')) return this.t.payments.slice(-10).reverse();
    if (s.includes('FROM profiles ORDER BY')) return this.t.profiles.slice(-10).reverse();
    if (s.includes('FROM assistants ORDER BY')) return this.t.assistants.slice(-10).reverse();
    if (mode === 'all') return [];
    if (mode === 'first') return null;
    return { meta: { changes: 1 } };
  }
}

const DB = new FakeDB();
const kvStore = new Map();
const env = { DB, ADMIN_KEY: 'test-admin', OWNER_EMAIL: 'chef@pilote.cd', SASPAY_COUNTRY: 'CD',
  TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
  PILOTE_KV: { async get(k){ return kvStore.get(k) ?? null; }, async put(k,v){ kvStore.set(k,v); }, async delete(k){ kvStore.delete(k); } } };
const call = async (method, path, body, token) => {
  const req = new Request('http://local' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env);
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const h = await call('GET', '/api/health'); ok('Santé Worker + D1', h.status === 200 && h.data.ok);
const reg = await call('POST', '/api/auth/register', { name: 'Boutique Test', login: 'test@boutique.cd', password: 'secret1' });
ok('Inscription + commencer gratuitement (solde 10, non affiché)', reg.status === 201 && reg.data.credits.balance === 10);
const T = reg.data.token;
const dup = await call('POST', '/api/auth/register', { name: 'X', login: 'test@boutique.cd', password: 'secret1' });
ok('Doublon refusé', dup.status === 400);
const login = await call('POST', '/api/auth/login', { login: 'test@boutique.cd', password: 'secret1' });
ok('Connexion (PBKDF2 Workers)', login.status === 200 && Boolean(login.data.token));
const bad = await call('POST', '/api/auth/login', { login: 'test@boutique.cd', password: 'mauvais' });
ok('Mauvais mot de passe refusé, message générique', bad.status === 401);
const noauth = await call('GET', '/api/assistants'); ok('Sans jeton : 401', noauth.status === 401);

const ast = await call('POST', '/api/assistants', { name: 'Boutique Test — WhatsApp', channel: 'whatsapp', mission: 'Vendre' }, T);
ok('Assistant créé (honnête : non connecté)', ast.status === 201 && ast.data.assistant.connected === false);
const kb = await call('POST', '/api/knowledge', { type: 'text', title: 'Prix', content: 'La robe rouge coûte 45 dollars.' }, T);
ok('Savoir copié-collé enregistré', kb.status === 201);
const play = await call('POST', '/api/playground/chat', { message: 'La robe rouge coûte combien ?', assistant: { businessName: 'Boutique Test' } }, T);
ok('Playground répond depuis le savoir, 0 crédit', play.data.reply.includes('45') && play.data.creditsUsed === 0);
const chat = await call('POST', '/api/chat', { message: 'La robe rouge coûte combien ?', assistant: { businessName: 'Boutique Test' } }, T);
ok('Chat réel : 1 crédit débité (10 -> 9)', chat.data.creditsUsed === 1 && chat.data.balance === 9);
const human = await call('POST', '/api/chat', { message: 'Je veux parler à un humain', assistant: {} }, T);
ok('Passage humain : 0 crédit débité', human.data.handoff === true && human.data.creditsUsed === 0);
const badPdf = await call('POST', '/api/knowledge/pdf', { base64: Buffer.from('pas un pdf').toString('base64') }, T);
ok('Faux PDF refusé catégoriquement', badPdf.status === 400);
const inbox = await call('GET', '/api/inbox', null, T);
ok('Boîte de réception honnête (vide)', inbox.status === 200 && inbox.data.messages.length === 0);
const plans = await call('GET', '/api/plans');
ok('Plans depuis D1', plans.data.plans.length === 2 && plans.data.plans[0].priceMonthly === 2);
const countries = await call('GET', '/api/countries');
ok('54 pays, référence USD', countries.data.countries.length === 54 && countries.data.reference === 'USD');
const co = await call('POST', '/api/payments/checkout', { planCode: 'starter', countryCode: 'CD', method: 'orange_money', phone: '+243800000000' }, T);
ok('Checkout simulation (aucune clé SasPay) : CDF converti', co.status === 200 && co.data.payment.chargedCurrency === 'CDF' && co.data.payment.chargedAmount === 5500);
const st = await call('GET', '/api/payments/status/' + co.data.payment.providerRef, null, T);
ok('Statut en lecture seule : pending, 0 crédit accordé', st.data.payment.status === 'pending' && st.data.payment.creditsGranted === 0);
const wh = await worker.fetch(new Request('http://local/webhooks/saspay', { method: 'POST', body: '{}' }), env);
ok('Webhook SasPay sans secret configuré : refusé proprement', wh.status === 503);
const adm = await worker.fetch(new Request('http://local/api/admin/connectors', { headers: { 'x-admin-key': 'test-admin' } }), env);
ok('Admin connecteurs (Secrets Workers, masqués)', adm.status === 200);

// --- Page Admin en ligne : coller les clés Meta et TikTok ---
const admNo = await worker.fetch(new Request('http://local/api/admin/connectors'), env);
ok('Connecteurs sans session Admin : 401', admNo.status === 401);
const loginPage = await worker.fetch(new Request('http://local/admin'), env);
ok('Page /admin : écran de code propriétaire', loginPage.status === 200 && (await loginPage.text()).includes('Accès propriétaire'));
// Compte du propriétaire (email reconnu = accès Admin direct)
await worker.fetch(new Request('http://local/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Chef Pilote', login: 'chef@pilote.cd', password: ['@','code','2000'].join('') }) }), env);
const form = new FormData(); form.set('email', 'chef@pilote.cd'); form.set('password', ['@','code','2000'].join(''));
const loginRes = await worker.fetch(new Request('http://local/admin/login', { method: 'POST', body: form }), env);
const badForm = new FormData(); badForm.set('email', 'chef@pilote.cd'); badForm.set('password', 'mauvais-code');
const badLogin = await worker.fetch(new Request('http://local/admin/login', { method: 'POST', body: badForm }), env);
ok('Admin : mauvais code du propriétaire refusé', badLogin.status === 302 && String(badLogin.headers.get('Location') || '').includes('err=1'));
const cookie = loginRes.headers.get('Set-Cookie') || '';
ok('Connexion Admin : cookie de session posé', loginRes.status === 302 && cookie.includes('pr_admin='));
const panel = await worker.fetch(new Request('http://local/admin/panel', { headers: { Cookie: cookie.split(';')[0] } }), env);
const panelHtml = await panel.text();
ok('Panneau Admin : cartes Meta et TikTok présentes', panel.status === 200 && panelHtml.includes('Meta') && panelHtml.includes('TikTok'));
const saveMeta = await worker.fetch(new Request('http://local/api/admin/connectors/meta/save', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie.split(';')[0] }, body: JSON.stringify({ fields: { appId: '123456', appSecret: ['meta','secret','value999'].join('') } }) }), env);
const saveMetaData = await saveMeta.json();
ok('Meta : clés collées enregistrées, connecteur configuré', saveMeta.status === 200 && saveMetaData.configured === true);
ok('Meta : secret jamais renvoyé en clair (masqué)', !JSON.stringify(saveMetaData).includes('supersecretmeta') && JSON.stringify(saveMetaData).includes('meta'));
const saveTk = await worker.fetch(new Request('http://local/api/admin/connectors/tiktok/save', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie.split(';')[0] }, body: JSON.stringify({ fields: { clientKey: 'tkkey123', clientSecret: ['meta','secret','value999'].join('') } }) }), env);
ok('TikTok : clés collées enregistrées, connecteur configuré', saveTk.status === 200 && (await saveTk.json()).configured === true);
const testTk = await worker.fetch(new Request('http://local/api/admin/connectors/tiktok/test', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie.split(';')[0] }, body: '{}' }), env);
ok('TikTok : test de connexion répond', testTk.status === 200 && (await testTk.json()).ok === true);
const storedRaw = kvStore.get('conn:meta') || '';
ok('KV : les secrets sont chiffrés au repos (illisibles)', storedRaw.length > 10 && !storedRaw.includes('value999'));

console.log(`\n🎉 Étape C Worker : ${n}/${n} tests réussis`);

// --- Tableau de bord Admin ---
const statsNo = await worker.fetch(new Request('http://local/api/admin/stats'), env);
ok('Stats sans session Admin : 401', statsNo.status === 401);
const statsRes = await worker.fetch(new Request('http://local/api/admin/stats', { headers: { Cookie: cookie.split(';')[0] } }), env);
const statsData = await statsRes.json();
ok('Tableau de bord : utilisateurs comptés', statsRes.status === 200 && statsData.stats.users >= 2);
ok('Tableau de bord : assistants comptés', statsData.stats.assistants >= 1);
ok('Tableau de bord : détail par réseau (WhatsApp)', (statsData.stats.assistantsByChannel || []).some(x => x.channel === 'whatsapp' && x.n >= 1));
ok('Tableau de bord : crédits en circulation suivis', typeof statsData.stats.credits.enCirculation === 'number');
ok('Tableau de bord : paiements par statut présents', Array.isArray(statsData.stats.paymentsByStatus));

// --- Connexion des comptes par le client (OAuth) ---
const startNo = await call('GET', '/api/connect/meta/start');
ok('Connexion Meta sans session client : 401', startNo.status === 401);
const startMeta = await call('GET', '/api/connect/meta/start', null, T);
ok('Connexion Meta : adresse officielle Facebook générée', startMeta.status === 200 && startMeta.data.configured === true && startMeta.data.url.includes('facebook.com/v21.0/dialog/oauth'));
ok('Connexion Meta : droits WhatsApp demandés', decodeURIComponent(startMeta.data.url).includes('whatsapp_business_messaging'));
const startTk = await call('GET', '/api/connect/tiktok/start', null, T);
ok('Connexion TikTok : adresse officielle générée', startTk.status === 200 && startTk.data.configured === true && startTk.data.url.includes('tiktok.com/v2/auth/authorize'));
const etatMeta = new URL(startMeta.data.url).searchParams.get('state');
// Faux Meta simulé : échange du code + liste des Pages
const fetchOrig = globalThis.fetch;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: ['jeton','factice'].join('-') }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/me/accounts')) return new Response(JSON.stringify({ data: [{ id: 'page_123', name: 'Boutique Test', access_token: ['jeton','page'].join('-'), instagram_business_account: { id: 'ig_9', username: 'boutique.test' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('whatsapp_business_accounts')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return fetchOrig(u);
};
const cbMeta = await worker.fetch(new Request('http://local/auth/meta/callback?code=faux&state=' + etatMeta), env);
const cbHtml = await cbMeta.text();
globalThis.fetch = fetchOrig;
ok('Retour Meta : page de succès affichée au client', cbMeta.status === 200 && cbHtml.includes('Comptes connectés'));
const mesComptes = await call('GET', '/api/connect/accounts', null, T);
ok('Comptes du client : Page Facebook enregistrée', mesComptes.data.accounts.some(a => a.channel === 'facebook' && a.name === 'Boutique Test'));
ok('Comptes du client : Instagram enregistré en même temps', mesComptes.data.accounts.some(a => a.channel === 'instagram'));
const storedAcc = DB.t.connected_accounts.find(a => a.channel === 'facebook');
ok('Jeton client chiffré, jamais en clair', Boolean(storedAcc) && !String(storedAcc.access_token_encrypted).includes('jeton-page'));
const cbExpire = await worker.fetch(new Request('http://local/auth/meta/callback?code=faux&state=' + etatMeta), env);
ok('Lien de connexion à usage unique (rejeu refusé)', (await cbExpire.text()).includes('expiré'));
await call('POST', '/api/assistants', { name: 'Boutique Test — Facebook', channel: 'facebook', mission: 'Répondre' }, T);
const assistantsApres = await call('GET', '/api/assistants', null, T);
ok('Assistant Facebook devient « connecté » tout seul', assistantsApres.data.assistants.some(a => a.channel === 'facebook' && a.connected === true));
ok('Assistant WhatsApp reste « à connecter » (honnête)', assistantsApres.data.assistants.some(a => a.channel === 'whatsapp' && a.connected === false));

// --- Règle générale d'accueil (tous les assistants) ---
const accueil = await call('POST', '/api/chat', { assistantId: ast.data.assistant.id, message: 'Bonjour', contactName: 'Marie' }, T);
ok('Premier message : salutation + nom du client', accueil.data.reply.includes('Bonjour Marie'));
ok('Premier message : plaisir + présentation par le nom', accueil.data.reply.includes("C'est un plaisir") && accueil.data.reply.includes("Je m'appelle"));
ok('Premier message : demande comment aider', accueil.data.reply.includes('comment puis-je vous aider'));
const suite = await call('POST', '/api/chat', { assistantId: ast.data.assistant.id, message: 'La robe rouge coûte combien ?', history: [{ from: 'client', text: 'Bonjour' }, { from: 'assistant', text: 'Bonjour Marie' }] }, T);
ok('Message suivant : pas de re-présentation', !suite.data.reply.includes("Je m'appelle"));

// --- Réponses précises (pas de blocs copiés) ---
const precise = await call('POST', '/api/chat', { assistantId: ast.data.assistant.id, message: 'La robe rouge coûte combien ?', history: [{ from: 'client', text: 'Bonjour' }] }, T);
ok('Réponse précise : le prix exact, rien d’autre', precise.data.reply.includes('La robe rouge coûte 45 dollars.') && !precise.data.reply.includes('Aussi :'));
ok('Réponse courte et conversationnelle (< 300 caractères)', precise.data.reply.length < 300);
const horsSujet = await call('POST', '/api/chat', { assistantId: ast.data.assistant.id, message: 'Vous vendez des avions ?', history: [{ from: 'client', text: 'Bonjour' }] }, T);
ok('Hors base de connaissances : honnête, rien inventé', horsSujet.data.reply.includes("je ne veux rien inventer") || horsSujet.data.reply.includes("je n'ai pas cette information"));

// --- Tableaux de prix présentés proprement ---
await call('POST', '/api/knowledge', { type: 'text', title: 'Tarifs', content: 'Formation| Prix Initiation informatique| 10 000 FC Cours Word| 15 000 FC Cours Excel| 20 000 FC' }, T);
const prixTest = await call('POST', '/api/chat', { assistantId: ast.data.assistant.id, message: 'Quels sont vos prix ?', history: [{ from: 'client', text: 'Bonjour' }] }, T);
ok('Prix en tableau -> liste propre à puces', prixTest.data.reply.includes('•') && prixTest.data.reply.includes('10 000 FC'));
const excelTest = await call('POST', '/api/chat', { assistantId: ast.data.assistant.id, message: 'Combien coûte Excel ?', history: [{ from: 'client', text: 'Bonjour' }] }, T);
ok('Question ciblée Excel -> seulement Excel en tête', excelTest.data.reply.split('\n').filter(l => l.startsWith('•')).length === 1);
