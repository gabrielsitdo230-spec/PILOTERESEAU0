/**
 * SasPay — fournisseur de paiement (Mobile Money + cartes, Afrique).
 * Docs : https://docs.saspay.me — Base API : https://api.saspay.me/api/v1
 * Clé secrète SERVEUR UNIQUEMENT (jamais côté client) : SASPAY_SECRET_KEY (sk_test_... / sk_live_...).
 * RDC supportée (pays CD, devise par défaut CDF) ; le client choisit son réseau sur le checkout hébergé.
 */
'use strict';
const crypto = require('crypto');

const envKey = (...parts) => process.env[parts.join('_')] || '';
const cfg = {
  secretKey: envKey('SASPAY', 'SECRET', 'KEY') || envKey('SASPAY', 'API', 'KEY'),
  webhookSecret: envKey('SASPAY', 'WEBHOOK', 'SECRET'),
  baseUrl: (process.env.SASPAY_BASE_URL || 'https://api.saspay.me/api/v1').replace(/\/$/, ''),
  country: process.env.SASPAY_COUNTRY || 'CD',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
};
function isLive() { return Boolean(cfg.secretKey); }
function mode() { return cfg.secretKey.startsWith('sk_live') ? 'live' : cfg.secretKey ? 'test' : 'off'; }

async function api(method, path, body, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(cfg.baseUrl + path, {
      method, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secretKey}`, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false) {
      const msg = data.error?.detail || data.error?.message || data.message || `SasPay HTTP ${r.status}`;
      const e = new Error('SasPay : ' + String(msg).slice(0, 240));
      e.status = r.status;
      throw e;
    }
    return data.data || data;
  } finally { clearTimeout(timer); }
}

/** Crée une session de checkout hébergé : le client choisit son réseau et paie sur la page SasPay. */
async function createCheckoutSession({ amount, currency, description, customerEmail, customerName, customerPhone, countryCode }) {
  const email = /.+@.+\..+/.test(customerEmail || '') ? customerEmail : 'client@pilotereseau.local';
  return api('POST', '/checkout-sessions/', {
    amount: Number(amount).toFixed(2),
    currency,
    description: String(description || 'Pilote Réseau').slice(0, 120),
    country: countryCode || cfg.country,
    customer_email: email,
    customer_name: String(customerName || 'Client Pilote Réseau').slice(0, 80),
    customer_phone: customerPhone || '',
    return_url: cfg.publicBaseUrl + '/',
  }, { 'Idempotency-Key': crypto.randomUUID() });
}

/** Statut réel d'une session (à interroger avant de créditer — jamais de confiance aveugle). */
async function getCheckoutStatus(sessionId) {
  return api('GET', `/checkout-sessions/${encodeURIComponent(sessionId)}/status/`);
}
async function verifyPayment(paymentId) {
  return api('GET', `/payments/${encodeURIComponent(paymentId)}/verify/`);
}

const SUCCESS_STATES = ['SUCCESS', 'SUCCEEDED', 'PAID', 'COMPLETED', 'SUCCESSFUL'];
function isSuccessStatus(status) { return SUCCESS_STATES.includes(String(status || '').toUpperCase()); }
function isFailedStatus(status) { return ['FAILED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(String(status || '').toUpperCase()); }

/**
 * Vérifie un webhook SasPay : signature HMAC-SHA256 sur "{timestamp}.{corps brut}"
 * + fraîcheur de l'horodatage (5 minutes max, anti-rejeu). Deux contrôles obligatoires.
 */
function isValidWebhook(rawBody, signatureHeader, timestampHeader) {
  if (!cfg.webhookSecret) return false;
  if (!signatureHeader || !timestampHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(`${timestampHeader}.${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signatureHeader).toLowerCase()));
  } catch { return false; }
}

module.exports = { cfg, isLive, mode, createCheckoutSession, getCheckoutStatus, verifyPayment, isSuccessStatus, isFailedStatus, isValidWebhook };
