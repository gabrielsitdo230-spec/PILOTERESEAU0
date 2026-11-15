/**
 * Cerveau de l'assistant IA.
 * Pipeline d'une réponse (< 10 s) :
 *   1. Construire les instructions (prompt système) depuis la mission + les 5 réponses
 *   2. Chercher dans la base de connaissances les extraits pertinents
 *   3. Détecter les demandes d'humain / sujets sensibles -> passage à un humain
 *   4. Appeler le vrai LLM si une clé est configurée, sinon moteur local
 *   5. Ne JAMAIS inventer : si l'info n'est pas dans la KB, le dire et proposer un humain
 */
'use strict';

const knowledge = require('./knowledge');
const llm = require('./llm');

const HUMAN_TRIGGERS = [
  'humain', 'une personne', 'un humain', 'vrai personne', 'le patron', 'la patronne',
  'proprietaire', 'responsable', 'agent', 'quelqu\'un de vrai', 'parler a quelqu',
  'rappelez-moi', 'appelez-moi', 'plainte', 'remboursement', 'arnaque', 'avocat',
];

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function wantsHuman(text) {
  const t = normalize(text);
  return HUMAN_TRIGGERS.some(k => t.includes(normalize(k)));
}

/** Étape guidée : 5 réponses simples -> instructions complètes écrites par le système. */
function buildInstructions({ businessName, activity, zone, hours, tone, mission, name }) {
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
    '- Si le client demande un humain, est en colère, ou parle de remboursement/plainte : reste poli et déclenche le passage à un humain.',
    '- Termine souvent par une petite question pour aider le client à avancer (commander, réserver, etc.).',
  ].filter(Boolean).join('\n');
}

function buildSystemPrompt(assistant, kbExtracts) {
  const ctx = kbExtracts.length
    ? kbExtracts.map((e, i) => `[Info ${i + 1} — ${e.title}] ${e.content}`).join('\n')
    : '(Aucune information trouvée dans la base de connaissances pour cette question.)';
  return `${assistant.instructions}\n\n--- INFORMATIONS SUR L'ACTIVITÉ (à utiliser, sans rien inventer d\'autre) ---\n${ctx}`;
}

/** Moteur local (sans clé IA) : répond à partir des extraits KB réellement trouvés. */
function localReply({ assistant, userText, kbExtracts }) {
  const t = normalize(userText);
  const biz = assistant.businessName || 'chez nous';
  if (/\b(bonjour|bonsoir|salut|hello|bjr)\b/.test(t) && t.length < 40) {
    return `Bonjour et bienvenue chez ${biz} 😊 Comment puis-je vous aider aujourd'hui ?`;
  }
  if (wantsHuman(userText)) {
    return `Bien sûr, je vous mets en relation avec une personne de l'équipe 🙋 Elle va vous répondre ici même très vite. Merci de patienter un instant !`;
  }
  if (kbExtracts.length) {
    const best = kbExtracts[0].content.replace(/\s+/g, ' ').trim();
    const extra = kbExtracts[1] ? `\n\nAussi : ${kbExtracts[1].content.replace(/\s+/g, ' ').trim().slice(0, 220)}` : '';
    return `${best}${extra}\n\nAutre chose que je peux faire pour vous ? 😊`;
  }
  return `Merci pour votre message ! 😊 Je n'ai pas cette information précise sous la main, et je préfère ne rien inventer. Voulez-vous que je vous mette en relation avec une personne de l'équipe, ou pouvez-vous me préciser votre demande ?`;
}

/**
 * Génère une réponse.
 * @returns {Promise<{reply, handoff, usedKnowledge, mode, latencyMs}>}
 */
async function generateReply({ assistant, userText, history = [], workspaceId = 'demo' }) {
  const started = Date.now();
  const handoff = wantsHuman(userText);
  const kbExtracts = knowledge.search(userText, { workspaceId, limit: 3 });
  const systemPrompt = buildSystemPrompt(assistant, kbExtracts);

  let reply, mode;
  if (llm.hasRealLLM()) {
    try {
      reply = await llm.callRealLLM(systemPrompt, [
        ...history.map(m => ({ role: m.from === 'client' ? 'user' : 'assistant', content: m.text })),
        { role: 'user', content: userText },
      ]);
      mode = 'llm';
    } catch (e) {
      console.error('[assistant] LLM en échec, repli moteur local :', e.message);
      reply = localReply({ assistant, userText, kbExtracts });
      mode = 'local-fallback';
    }
  } else {
    reply = localReply({ assistant, userText, kbExtracts });
    mode = 'local-demo';
  }

  return {
    reply,
    handoff,
    usedKnowledge: kbExtracts.map(e => e.title),
    mode,
    latencyMs: Date.now() - started,
  };
}

module.exports = { buildInstructions, generateReply, wantsHuman, buildSystemPrompt };
