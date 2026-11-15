/**
 * Paiements — Flutterwave (principal) / CinetPay (secours) / simulation locale.
 * Flux sûr :
 *   1. POST /api/payments/checkout  -> paiement "pending", référence unique
 *   2. Le client paie (Mobile Money / carte) chez le fournisseur
 *   3. Webhook fournisseur          -> vérifié + IDEMPOTENT : crédits ajoutés UNE seule fois
 * Sans clé fournisseur : mode simulation (confirmation immédiate dans l'interface de démo).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const plans = require('./plans');
const credits = require('./credits');

const FILE = path.join(__dirname, '..', 'data', 'payments.json');
const METHODS = ['orange_money', 'mpesa', 'mtn_momo', 'airtel_money', 'card'];

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function save(list) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8'); }
let payments = load();

const flwKey = () => process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY || '';
function isLive() { return Boolean(flwKey()); }

function checkout({ workspaceId = 'demo', planCode, method, phone }) {
  const plan = plans.get(planCode);
  if (!plan || !plan.active) return { error: 'Ce plan n\'est pas disponible. Choisissez-en un autre.' };
  if (!METHODS.includes(method)) return { error: 'Moyen de paiement inconnu.' };
  const ref = 'pr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const payment = {
    id: ref, workspaceId, provider: isLive() ? 'flutterwave' : 'simulation',
    providerRef: ref, planCode: plan.code,
    amount: plan.priceMonthly, currency: plan.currency,
    method, phone: phone || '', status: 'pending',
    creditsGranted: 0, createdAt: new Date().toISOString(),
  };
  payments.unshift(payment); save(payments);
  const result = { payment };
  if (isLive()) {
    result.checkoutUrl = 'https://checkout.flutterwave.com/v3/hosted/pay'; // lien réel créé via API FLW à l'Étape 6 avec la clé
    result.note = 'Redirigez le client vers Flutterwave, puis attendez le webhook.';
  } else {
    result.simulated = true;
    result.note = 'Mode simulation : confirmez via POST /api/payments/simulate-confirm ou le bouton de démo.';
  }
  return result;
}

/** Confirmation (webhook réel ou simulation). IDEMPOTENT grâce à providerRef + statut. */
function confirm(providerRef, { status = 'success' } = {}) {
  const payment = payments.find(p => p.providerRef === providerRef);
  if (!payment) return { error: 'Paiement introuvable' };
  if (payment.status === 'success') return { payment, alreadyProcessed: true }; // jamais de double crédit
  if (status !== 'success') {
    payment.status = 'failed'; save(payments);
    return { payment, failed: true };
  }
  const plan = plans.get(payment.planCode);
  const creditsToGrant = plan ? plan.creditsIncluded : 0;
  payment.status = 'success';
  payment.creditsGranted = creditsToGrant;
  payment.confirmedAt = new Date().toISOString();
  save(payments);
  const balance = credits.grant(payment.workspaceId, creditsToGrant, 'achat_plan_' + payment.planCode);
  credits.setPlan(payment.workspaceId, payment.planCode, creditsToGrant);
  return { payment, balance };
}

function list(workspaceId) {
  return workspaceId ? payments.filter(p => p.workspaceId === workspaceId) : payments.slice();
}
function revenue() {
  return payments.filter(p => p.status === 'success')
    .reduce((acc, p) => { acc[p.currency] = (acc[p.currency] || 0) + Number(p.amount); return acc; }, {});
}

module.exports = { checkout, confirm, list, isLive, revenue, METHODS };
