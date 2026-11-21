/**
 * PILOTE RÉSEAU — Cerveau de l'assistant, version Workers (Étape C)
 * Mêmes règles que le serveur Node : réponses depuis la base de
 * connaissances uniquement, aucun prix inventé, passage à un humain.
 * PDF : décompression via DecompressionStream du runtime Workers
 * (remplace zlib Node, indisponible ici — validé par les tests).
 */

const STOPWORDS = new Set(['le','la','les','de','des','du','un','une','et','est','je','vous','tu','il','elle','nous','pour','dans','sur','avec','pas','que','qui','au','aux','ce','cette','mon','ma','mes','votre','vos','etre','avoir','faire','plus','sont','chez','moi','toi','lui','oui','non','si','se','en','par','a']);

export function tokenize(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}
function chunk(text, size = 500) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out.length ? out : [''];
}
export function searchKnowledge(rows, query, limit = 3) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const scored = [];
  for (const item of rows || []) {
    for (const piece of chunk(item.content)) {
      const pTokens = tokenize(piece);
      if (!pTokens.length) continue;
      const freq = new Map();
      pTokens.forEach(t => freq.set(t, (freq.get(t) || 0) + 1));
      let score = 0;
      for (const qt of qTokens) {
        if (freq.has(qt)) score += 1 + Math.log(1 + freq.get(qt));
        for (const [t, f] of freq) if (t !== qt && (t.startsWith(qt.slice(0, 5)) || qt.startsWith(t.slice(0, 5)))) score += 0.35;
      }
      const titleTokens = tokenize(item.title);
      for (const qt of qTokens) if (titleTokens.includes(qt)) score += 2;
      if (score > 0.8) scored.push({ title: item.title, content: piece, score: Math.round(score * 100) / 100 });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function wantsHuman(text) {
  const t = (text || '').toLowerCase();
  return ['humain', 'personne', 'patron', 'responsable', 'quelqu\'un', 'operateur', 'opérateur', 'agent réel', 'plainte', 'rembours'].some(k => t.includes(k));
}

export const PLATFORM_GREETING_RULE = [
  'RÈGLE GÉNÉRALE PILOTE RÉSEAU (obligatoire pour tous les assistants, prioritaire) :',
  'Au TOUT PREMIER message d\'une conversation, tu dois, dans cet ordre :',
  '1) saluer le client (Bonjour/Bonsoir selon le moment, sinon Bonjour) ;',
  '2) appeler le client par son nom si tu le connais (jamais inventer un nom) ;',
  '3) exprimer le plaisir de l\'accueillir (« ravi de vous accueillir chez nous ») ;',
  '4) te présenter par ton nom d\'assistant (« Je m\'appelle … ») ;',
  '5) donner quelques détails utiles sur l\'activité (ce que vous proposez, zone, horaires si connus — uniquement depuis le contexte, sans inventer) ;',
  '6) demander comment tu peux l\'aider par rapport à votre activité.',
  'Aux messages suivants, ne répète pas cette présentation : réponds naturellement et directement.',
].join('\n');

export function greetingIntro(assistant, contactName) {
  const brut = (assistant?.name || '').split('—')[0].trim();
  const generique = !brut || ['votre assistant', 'assistant', 'mon assistant', 'assistant virtuel'].includes(brut.toLowerCase());
  const presentation = generique ? 'Je suis votre assistant virtuel' : `Je m'appelle ${brut}, votre assistant virtuel`;
  const salut = contactName ? `Bonjour ${contactName} !` : 'Bonjour et bienvenue !';
  return `${salut} 😊 C'est un plaisir de vous accueillir chez nous. ${presentation}. Je suis là pour vous renseigner et vous aider rapidement, à tout moment.`;
}

export function buildInstructions({ businessName, activity, zone, hours, tone, mission, name }) {
  return [
    `Tu es l'assistant virtuel de « ${businessName || name || 'notre activité'} » sur les réseaux sociaux.`,
    `Ta mission principale : ${mission || 'répondre aux clients'}.`,
    activity ? `Ce que nous faisons : ${activity}.` : '',
    zone ? `Notre zone : ${zone}.` : '',
    hours ? `Nos horaires : ${hours}.` : '',
    `Ton ton : ${tone || 'chaleureux, poli et naturel, avec quelques emojis (sans exagérer)'}.`,
    'Règles strictes :',
    '- réponds dans la langue du client (français par défaut), phrases courtes et claires.',
    '- Utilise UNIQUEMENT les informations fournies dans le contexte. N\'invente jamais un prix, une disponibilité ou un délai.',
    '- Si l\'information n\'est pas dans le contexte, dis-le gentiment et propose de passer à un humain.',
    '- Termine souvent par une petite question pour aider le client à avancer.',
    PLATFORM_GREETING_RULE,
  ].filter(Boolean).join('\n');
}

function phrasesUtiles(kb, question, max = 3) {
  const qTokens = tokenize(question);
  const vues = new Set(); const notees = [];
  for (const extrait of kb || []) {
    const phrases = String(extrait.content || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(x => x.length >= 12);
    for (const ph of phrases) {
      const cle = ph.toLowerCase().slice(0, 60);
      if (vues.has(cle)) continue; vues.add(cle);
      const pTokens = tokenize(ph);
      let score = 0;
      for (const qt of qTokens) { if (pTokens.includes(qt)) score += 2; else if (pTokens.some(t => t.startsWith(qt.slice(0, 5)) || qt.startsWith(t.slice(0, 5)))) score += 0.6; }
      if (tokenize(extrait.title).some(t => qTokens.includes(t))) score += 1;
      notees.push({ ph, score });
    }
  }
  const propres = notees.filter(x => /^[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜ0-9«\"“]/.test(x.ph));
  const triees = (propres.length ? propres : notees).sort((a, b) => b.score - a.score).filter(x => x.score > 0);
  if (!triees.length) return [];
  const seuil = Math.max(1.5, triees[0].score * 0.55);
  return triees.filter(x => x.score >= seuil).slice(0, max).map(x => x.ph);
}

function listeDepuisTableaux(kbRows, question) {
  const qTokens = tokenize(question);
  const demandePrix = qTokens.some(t => ['prix', 'tarif', 'tarifs', 'cout', 'coute', 'combien', 'price'].includes(t));
  const items = [];
  for (const src of kbRows || []) {
    const brut = String(src.content || '').replace(/\s+/g, ' ');
    if (!brut.includes('|')) continue;
    const paires = [...brut.matchAll(/([^|]{3,70}?)\s*\|\s*([0-9][0-9 .]*\s*(?:FC|USD|\$|€|francs?)?)/gi)];
    for (const m of paires) {
      const label = m[1].trim().replace(/^(formation|service|produit)\s*/i, '').trim();
      const prix = m[2].trim();
      if (label.length < 3) continue;
      const pTokens = tokenize(label + ' ' + prix);
      let score = demandePrix ? 1.2 : 0;
      for (const qt of qTokens) if (pTokens.includes(qt)) score += 2;
      items.push({ texte: label + ' : ' + prix, score });
    }
  }
  let gardees = items.filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (gardees.length) { const maxScore = gardees[0].score; if (maxScore > 1.2) gardees = gardees.filter(x => x.score >= maxScore * 0.75); }
  gardees = gardees.slice(0, 8);
  if (!gardees.length || (gardees.length === 1 && gardees[0].score <= 1.2)) return '';
  return (demandePrix ? 'Voici nos tarifs :\n' : '') + gardees.map(x => '• ' + x.texte).join('\n');
}

function localReply(userText, kb, intro = '', kbRows = []) {
  if (wantsHuman(userText)) {
    return `${intro ? intro + '\n\n' : ''}Bien sûr, je vous mets en relation avec une personne de l'équipe 🙋 Elle va vous répondre ici même très vite. Merci de patienter un instant !`;
  }
  const texteNet = (userText || '').toLowerCase();
  if (intro && /\b(bonjour|bonsoir|salut|hello|bonjours)\b/.test(texteNet) && texteNet.length < 40) {
    const details = (kbRows.length ? kbRows : kb || []).flatMap(k => String(k.content || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length >= 12)).slice(0, 2);
    return `${intro}${details.length ? '\n\nPour vous donner une idée de ce que nous proposons : ' + details.join(' ') : ''}\n\nDites-moi, comment puis-je vous aider aujourd'hui par rapport à nos services ? 😊`;
  }
  const liste = listeDepuisTableaux(kbRows.length ? kbRows : kb, userText);
  if (liste && !wantsHuman(userText)) {
    const blocIntro = intro ? `${intro}\nDites-moi, comment puis-je vous aider aujourd'hui ?\n\n` : '';
    return `${blocIntro}${liste}\n\nSouhaitez-vous des précisions sur l'un de ces points ? 😊`;
  }
  const reponses = phrasesUtiles(kb, userText, 3);
  if (reponses.length) {
    const detailsOuverture = intro ? phrasesUtiles(kb, userText, 2) : [];
    const blocIntro = intro ? `${intro}${detailsOuverture.length ? '\n\nVoici déjà un premier élément : ' + detailsOuverture[0] : ''}\nDites-moi, comment puis-je vous aider aujourd'hui ?\n\n` : '';
    const corps = reponses.join(' ');
    return `${blocIntro}${corps}\n\nSouhaitez-vous que je vous aide pour autre chose ? 😊`;
  }
  const blocIntro = intro ? `${intro}\nDites-moi, comment puis-je vous aider aujourd'hui ?\n\n` : '';
  return `${blocIntro}Merci pour votre message ! 😊 Je préfère être honnête : je n'ai pas cette information précise dans ce que l'entreprise m'a appris, et je ne veux rien inventer. Voulez-vous que je vous mette en relation avec une personne de l'équipe, ou pouvez-vous me préciser votre demande ?`;
}

export async function generateReply(env, { assistant, userText, history = [], kbRows = [], contactName = '' }) {
  const isFirst = !history || history.length === 0;
  const intro = isFirst ? greetingIntro(assistant, contactName) : '';
  const started = Date.now();
  const kb = searchKnowledge(kbRows, userText, 3);
  const handoff = wantsHuman(userText);
  let reply, mode;
  if (env.LLM_API_KEY) {
    try {
      const ctx = kb.map(k => `[${k.title}] ${k.content}`).join('\n');
      const r = await fetch(`${env.LLM_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
        body: JSON.stringify({
          model: env.LLM_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: `${assistant?.instructions || ''}\n${PLATFORM_GREETING_RULE}\nEXIGENCE DE PRÉCISION : réponds EXACTEMENT à la question posée par le client, en 2 à 4 phrases courtes maximum. Affirme uniquement ce qui est écrit dans le contexte, avec certitude ; si le contexte ne contient pas la réponse, dis-le honnêtement sans rien inventer et propose un humain. Ne récite jamais de longs passages du contexte.\n${isFirst ? `Ceci est le premier message de la conversation. Nom du client : ${contactName || '(inconnu — ne pas inventer de nom)'}. Commence par l'accueil complet prévu par la règle générale, puis réponds à sa demande.` : 'Conversation en cours : ne répète pas la présentation.'}\nContexte (base de connaissances) :\n${ctx || '(vide — ne rien inventer)'}` },
            ...history.map(m => ({ role: m.from === 'client' ? 'user' : 'assistant', content: m.text })),
            { role: 'user', content: userText },
          ],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'LLM ' + r.status);
      reply = d.choices[0].message.content; mode = 'llm';
    } catch (e) { reply = localReply(userText, kb, intro, kbRows); mode = 'local-fallback'; erreurIA = String(e.message || e).slice(0, 160); }
  } else { reply = localReply(userText, kb, intro, kbRows); mode = 'local-demo'; }
  return { reply, handoff, usedKnowledge: kb.map(k => k.title), mode, erreurIA: typeof erreurIA !== 'undefined' ? erreurIA : undefined, latencyMs: Date.now() - started };
}

// ---------- PDF (Workers : DecompressionStream au lieu de zlib) ----------
function decodePdfString(s) {
  return s.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}
function textFromContent(buf) {
  const src = new TextDecoder('latin1').decode(buf);
  const out = [];
  const re = /\((?:\\.|[^\\()])*\)\s*(?:Tj|')|\[(?:\\.|[^\]\\])*\]\s*TJ/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const strings = m[0].match(/\((?:\\.|[^\\()])*\)/g) || [];
    out.push(strings.map(s => decodePdfString(s.slice(1, -1))).join(''), '\n');
  }
  return out.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
async function inflate(data) {
  try {
    const ds = new DecompressionStream('deflate');
    return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
  } catch { return data; }
}
export async function extractPdfText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 5 || new TextDecoder('latin1').decode(bytes.slice(0, 4)) !== '%PDF') {
    const e = new Error('not_a_pdf'); e.code = 'NOT_A_PDF'; throw e;
  }
  const raw = new TextDecoder('latin1').decode(bytes);
  const parts = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;
    const content = await inflate(bytes.slice(start, end));
    const t = textFromContent(content);
    if (t) parts.push(t);
    re.lastIndex = end + 9;
  }
  if (!parts.length) { const t = textFromContent(bytes); if (t) parts.push(t); }
  return parts.join('\n').replace(/\s+\n/g, '\n').trim().slice(0, 60000);
}
