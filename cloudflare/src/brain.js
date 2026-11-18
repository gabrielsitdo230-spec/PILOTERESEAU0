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
  ].filter(Boolean).join('\n');
}

function localReply(userText, kb) {
  if (wantsHuman(userText)) return `Bien sûr, je vous mets en relation avec une personne de l'équipe 🙋 Elle va vous répondre ici même très vite. Merci de patienter un instant !`;
  if (kb.length) {
    const best = kb[0].content.replace(/\s+/g, ' ').trim();
    const extra = kb[1] ? `\n\nAussi : ${kb[1].content.replace(/\s+/g, ' ').trim().slice(0, 220)}` : '';
    return `${best}${extra}\n\nAutre chose que je peux faire pour vous ? 😊`;
  }
  return `Merci pour votre message ! 😊 Je n'ai pas cette information précise sous la main, et je préfère ne rien inventer. Voulez-vous que je vous mette en relation avec une personne de l'équipe, ou pouvez-vous me préciser votre demande ?`;
}

export async function generateReply(env, { assistant, userText, history = [], kbRows = [] }) {
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
            { role: 'system', content: `${assistant?.instructions || ''}\nContexte (base de connaissances) :\n${ctx || '(vide — ne rien inventer)'}` },
            ...history.map(m => ({ role: m.from === 'client' ? 'user' : 'assistant', content: m.text })),
            { role: 'user', content: userText },
          ],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'LLM ' + r.status);
      reply = d.choices[0].message.content; mode = 'llm';
    } catch (e) { reply = localReply(userText, kb); mode = 'local-fallback'; }
  } else { reply = localReply(userText, kb); mode = 'local-demo'; }
  return { reply, handoff, usedKnowledge: kb.map(k => k.title), mode, latencyMs: Date.now() - started };
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
