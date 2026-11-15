/**
 * Fournisseur IA — côté serveur UNIQUEMENT.
 * La clé API ne doit JAMAIS se trouver dans le front.
 *
 * Mode 1 (production) : si LLM_API_KEY est défini dans .env,
 *   appel à une API compatible OpenAI (OpenAI, ou autre fournisseur compatible).
 * Mode 2 (démo, sans clé) : moteur local intelligent qui utilise
 *   réellement la base de connaissances (recherche par pertinence).
 */
'use strict';
const connectors = require('./connectors');

const config = { apiKey: '', baseUrl: '', model: '' };
function reload() {
  config.apiKey = connectors.get('ai', 'apiKey');
  config.baseUrl = (connectors.get('ai', 'baseUrl') || 'https://api.openai.com/v1').replace(/\/$/, '');
  config.model = connectors.get('ai', 'model') || 'gpt-4o-mini';
  return config;
}
reload();

function hasRealLLM() { return Boolean(config.apiKey); }

/** Appel au vrai modèle de langage (compatible OpenAI). Timeout 8s pour tenir < 10s au total. */
async function callRealLLM(systemPrompt, history) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.6,
        max_tokens: 350,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-10),
        ],
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Réponse IA vide');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { hasRealLLM, callRealLLM, config, reload };
