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
const saspay = require('./saspay');
const countries = require('./countries');
const credits = require('./credits');

const FILE = path.join(__dirname, '..', 'data', 'payments.json');
const METHODS = ['orange_money', 'mpesa', 'mtn_momo', 'airtel_money', 'card'];

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function save(list) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8'); }
let payments = load();

const flwKey = () => process.env.FLW_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY || '';
function activeProvider() { return saspay.isLive() ? 'saspay' : flwKey() ? 'flutterwave' : 'simulation'; }
function isLive() { return activeProvider() !== 'simulation'; }

async function checkout({ workspaceId = 'demo', planCode, method, phone, customerEmail, customerName, countryCode }) {
  const plan = plans.get(planCode);
  if (!plan || !plan.active) return { error: 'Ce plan n\'est pas disponible. Choisissez-en un autre.' };
  if (!METHODS.includes(method)) return { error: 'Moyen de paiement inconnu.' };
  const ref = 'pr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const provider = activeProvider();
  // Pays choisi par le client : prix USD de référence, débit dans SA devise locale (pays SasPay).
  const country = countries.get(countryCode) || countries.get('CD');
  const charge = provider === 'saspay' && country.sasPay
    ? countries.convert(plan.priceMonthly, country)
    : { amount: plan.priceMonthly, currency: 'USD', rate: 1 };
  const payment = {
    id: ref, workspaceId, provider,
    providerRef: ref, planCode: plan.code,
    amount: plan.priceMonthly, currency: plan.currency, // référence USD du plan
    country: country.code, countryName: country.name,
    chargedAmount: charge.amount, chargedCurrency: charge.currency, fxRate: charge.rate,
    method, phone: phone || '', status: 'pending',
    creditsGranted: 0, createdAt: new Date().toISOString(),
  };
  const result = { payment };
  if (provider === 'saspay') {
    try {
      const session = await saspay.createCheckoutSession({
        amount: charge.amount, currency: charge.currency, countryCode: country.code,
        description: `Pilote Réseau — Plan ${plan.name} (${plan.creditsIncluded} messages IA) — ${plan.priceMonthly} USD`,
        customerEmail, customerName, customerPhone: phone,
      });
      payment.saspaySessionId = session.id || session.session_id || '';
      payment.status = 'pending';
      result.checkoutUrl = session.checkout_url || '';
      result.saspay = { sessionId: payment.saspaySessionId, status: session.status || 'PENDING', mode: saspay.mode() };
      result.note = result.checkoutUrl
        ? 'Redirigez le client vers la page de paiement SasPay (il choisit Orange Money, M-Pesa, carte…). Les crédits arrivent dès confirmation (webhook + vérification).'
        : 'Session SasPay créée sans URL de paiement : vérifiez la réponse SasPay.';
    } catch (e) {
      payment.status = 'failed';
      payment.error = e.message;
      payments.unshift(payment); save(payments);
      return { error: 'Le paiement SasPay n\'a pas pu démarrer : ' + e.message };
    }
  } else if (provider === 'flutterwave') {
    result.checkoutUrl = 'https://checkout.flutterwave.com/v3/hosted/pay'; // lien réel créé via API FLW à l'Étape 6 avec la clé
    result.note = 'Redirigez le client vers Flutterwave, puis attendez le webhook.';
  } else {
    result.simulated = true;
    result.note = 'Mode simulation : confirmez via POST /api/payments/simulate-confirm ou le bouton de démo.';
  }
  payments.unshift(payment); save(payments);
  return result;
}

/**
 * Lecture SEULE du statut (pour afficher l'attente au client).
 * NE CRÉDITE JAMAIS : seul le webhook signé SasPay, revérifié auprès de l'API, peut valider un paiement.
 */
async function checkStatusOnly(providerRef) {
  const payment = payments.find(p => p.providerRef === providerRef);
  if (!payment) return { error: 'Paiement introuvable' };
  if (payment.status !== 'pending') return { payment };
  if (payment.provider === 'saspay' && payment.saspaySessionId) {
    try {
      const st = await saspay.getCheckoutStatus(payment.saspaySessionId);
      payment.saspayStatus = st.status || st.state || payment.saspayStatus || '';
      payment.lastStatusCheck = new Date().toISOString();
      save(payments);
    } catch { /* l'affichage ne doit jamais casser */ }
  }
  return { payment, pending: true };
}

/**
 * VALIDATION OFFICIELLE — appelée UNIQUEMENT par le webhook SasPay (signé et frais).
 * Double contrôle : 1) le statut est revérifié directement auprès de l'API SasPay,
 * 2) succès confirmé -> crédits (idempotent) ; échec/annulation -> paiement ANNULÉ catégoriquement, 0 crédit.
 */
async function validateFromSaspaySignal(providerRef) {
  const payment = payments.find(p => p.providerRef === providerRef);
  if (!payment) return { error: 'Paiement introuvable' };
  if (payment.status === 'success') return { payment, alreadyProcessed: true };
  if (payment.provider !== 'saspay' || !payment.saspaySessionId) return { payment, ignored: true };
  const st = await saspay.getCheckoutStatus(payment.saspaySessionId);
  const status = st.status || st.state || '';
  payment.saspayStatus = status;
  payment.lastStatusCheck = new Date().toISOString();
  if (saspay.isSuccessStatus(status)) {
    save(payments);
    return confirm(providerRef, { status: 'success' }); // l'argent est bien chez SasPay -> accès accordé
  }
  if (saspay.isFailedStatus(status)) {
    payment.status = 'cancelled'; // annulation catégorique : aucun crédit, achat à reprendre
    payment.cancelledAt = new Date().toISOString();
    save(payments);
    return { payment, cancelled: true };
  }
  save(payments);
  return { payment, pending: true, saspayStatus: status };
}

/** Webhook SasPay : chaque paiement en attente est revérifié puis validé ou annulé. */
async function confirmPendingSaspay() {
  const pending = payments.filter(p => p.provider === 'saspay' && p.status === 'pending');
  const results = [];
  for (const pmt of pending) {
    try { results.push({ ref: pmt.providerRef, ...(await validateFromSaspaySignal(pmt.providerRef)) }); }
    catch (e) { results.push({ ref: pmt.providerRef, error: e.message }); }
  }
  return results;
}

/** Compat : ancien nom utilisé par d'anciens appels = lecture seule (ne crédite plus). */
async function checkAndConfirm(providerRef) { return checkStatusOnly(providerRef); }

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

module.exports = { checkout, confirm, list, isLive, revenue, METHODS, activeProvider, checkAndConfirm, checkStatusOnly, validateFromSaspaySignal, confirmPendingSaspay };
