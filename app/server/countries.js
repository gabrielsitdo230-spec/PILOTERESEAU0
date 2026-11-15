/**
 * Pays africains + devises — pour le paiement SasPay.
 * - Les prix des plans restent en USD (référence).
 * - Au paiement, le client choisit son pays : le montant est converti dans sa devise
 *   locale au taux indicatif ci-dessous (à ajuster ici ou via un taux réel plus tard),
 *   et SasPay débite dans cette devise sur le réseau local du pays.
 * - sasPay: true = pays couvert par SasPay (doc officielle). Sinon, paiement carte en USD.
 * Taux = unités de devise pour 1 USD (indicatifs, nov. 2026 — à réviser régulièrement).
 */
'use strict';

const COUNTRIES = [
  // Pays couverts par SasPay (18, doc officielle SasPay)
  { code: 'CD', name: 'République Démocratique du Congo', currency: 'CDF', rate: 2750, sasPay: true },
  { code: 'CG', name: 'Congo', currency: 'XAF', rate: 605, sasPay: false },
  { code: 'CI', name: 'Côte d\'Ivoire', currency: 'XOF', rate: 605, sasPay: true },
  { code: 'SN', name: 'Sénégal', currency: 'XOF', rate: 605, sasPay: true },
  { code: 'CM', name: 'Cameroun', currency: 'XAF', rate: 605, sasPay: true },
  { code: 'BJ', name: 'Bénin', currency: 'XOF', rate: 605, sasPay: true },
  { code: 'BF', name: 'Burkina Faso', currency: 'XOF', rate: 605, sasPay: true },
  { code: 'ML', name: 'Mali', currency: 'XOF', rate: 605, sasPay: true },
  { code: 'TG', name: 'Togo', currency: 'XOF', rate: 605, sasPay: true },
  { code: 'NE', name: 'Niger', currency: 'XOF', rate: 605, sasPay: true },
  { code: 'GN', name: 'Guinée', currency: 'GNF', rate: 8600, sasPay: true },
  { code: 'GH', name: 'Ghana', currency: 'GHS', rate: 16, sasPay: true },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', rate: 1600, sasPay: true },
  { code: 'KE', name: 'Kenya', currency: 'KES', rate: 130, sasPay: true },
  { code: 'UG', name: 'Ouganda', currency: 'UGX', rate: 3700, sasPay: true },
  { code: 'TZ', name: 'Tanzanie', currency: 'TZS', rate: 2500, sasPay: true },
  { code: 'RW', name: 'Rwanda', currency: 'RWF', rate: 1350, sasPay: true },
  { code: 'MW', name: 'Malawi', currency: 'MWK', rate: 1750, sasPay: true },
  { code: 'ZM', name: 'Zambie', currency: 'ZMW', rate: 26, sasPay: true },
  // Autres pays africains (paiement par carte en USD en attendant une couverture locale)
  { code: 'AO', name: 'Angola', currency: 'AOA', rate: 920, sasPay: false },
  { code: 'DZ', name: 'Algérie', currency: 'DZD', rate: 132, sasPay: false },
  { code: 'BW', name: 'Botswana', currency: 'BWP', rate: 13.5, sasPay: false },
  { code: 'BI', name: 'Burundi', currency: 'BIF', rate: 2900, sasPay: false },
  { code: 'CV', name: 'Cap-Vert', currency: 'CVE', rate: 102, sasPay: false },
  { code: 'CF', name: 'République Centrafricaine', currency: 'XAF', rate: 605, sasPay: false },
  { code: 'TD', name: 'Tchad', currency: 'XAF', rate: 605, sasPay: false },
  { code: 'KM', name: 'Comores', currency: 'KMF', rate: 455, sasPay: false },
  { code: 'DJ', name: 'Djibouti', currency: 'DJF', rate: 178, sasPay: false },
  { code: 'EG', name: 'Égypte', currency: 'EGP', rate: 48, sasPay: false },
  { code: 'ER', name: 'Érythrée', currency: 'ERN', rate: 15, sasPay: false },
  { code: 'SZ', name: 'Eswatini', currency: 'SZL', rate: 18, sasPay: false },
  { code: 'ET', name: 'Éthiopie', currency: 'ETB', rate: 125, sasPay: false },
  { code: 'GA', name: 'Gabon', currency: 'XAF', rate: 605, sasPay: false },
  { code: 'GM', name: 'Gambie', currency: 'GMD', rate: 71, sasPay: false },
  { code: 'GW', name: 'Guinée-Bissau', currency: 'XOF', rate: 605, sasPay: false },
  { code: 'LS', name: 'Lesotho', currency: 'LSL', rate: 18, sasPay: false },
  { code: 'LR', name: 'Liberia', currency: 'LRD', rate: 190, sasPay: false },
  { code: 'LY', name: 'Libye', currency: 'LYD', rate: 4.8, sasPay: false },
  { code: 'MG', name: 'Madagascar', currency: 'MGA', rate: 4600, sasPay: false },
  { code: 'MA', name: 'Maroc', currency: 'MAD', rate: 10, sasPay: false },
  { code: 'MR', name: 'Mauritanie', currency: 'MRU', rate: 40, sasPay: false },
  { code: 'MU', name: 'Maurice', currency: 'MUR', rate: 46, sasPay: false },
  { code: 'MZ', name: 'Mozambique', currency: 'MZN', rate: 64, sasPay: false },
  { code: 'NA', name: 'Namibie', currency: 'NAD', rate: 18, sasPay: false },
  { code: 'ST', name: 'Sao Tomé-et-Principe', currency: 'STN', rate: 22.5, sasPay: false },
  { code: 'SC', name: 'Seychelles', currency: 'SCR', rate: 14, sasPay: false },
  { code: 'SL', name: 'Sierra Leone', currency: 'SLE', rate: 23, sasPay: false },
  { code: 'SO', name: 'Somalie', currency: 'SOS', rate: 570, sasPay: false },
  { code: 'ZA', name: 'Afrique du Sud', currency: 'ZAR', rate: 18, sasPay: false },
  { code: 'SS', name: 'Soudan du Sud', currency: 'SSP', rate: 4700, sasPay: false },
  { code: 'SD', name: 'Soudan', currency: 'SDG', rate: 600, sasPay: false },
  { code: 'TN', name: 'Tunisie', currency: 'TND', rate: 3.1, sasPay: false },
  { code: 'ZW', name: 'Zimbabwe', currency: 'ZWG', rate: 25, sasPay: false },
  { code: 'GQ', name: 'Guinée Équatoriale', currency: 'XAF', rate: 605, sasPay: false },
];

function list() { return COUNTRIES.slice(); }
function get(code) { return COUNTRIES.find(c => c.code === String(code || '').toUpperCase()) || null; }

/** Convertit un prix USD vers la devise du pays (arrondi propre selon la devise). */
function convert(usdAmount, country) {
  if (!country || !country.rate) return { amount: Number(usdAmount), currency: 'USD', rate: 1 };
  const raw = Number(usdAmount) * country.rate;
  const rounded = raw >= 1000 ? Math.round(raw / 10) * 10 : Math.round(raw * 100) / 100;
  return { amount: rounded, currency: country.currency, rate: country.rate };
}

module.exports = { list, get, convert, COUNTRIES };
