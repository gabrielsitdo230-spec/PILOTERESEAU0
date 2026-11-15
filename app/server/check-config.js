/**
 * Vérification de configuration — lancer : npm run check
 * Dit exactement ce qui est prêt et ce qu'il vous reste à configurer.
 * Ne révèle JAMAIS la valeur des secrets (juste : présent / manquant / invalide).
 */
'use strict';

const rows = [];
function row(service, ok, detail, required = true) {
  rows.push({ service, ok, detail, required });
}

const env = process.env;
const has = (k) => Boolean(env[k] && String(env[k]).trim());

row('Clé IA (LLM_API_KEY)', has('LLM_API_KEY'), has('LLM_API_KEY') ? 'Vrai modèle IA actif' : 'Mode démo locale — ajoutez la clé de votre fournisseur IA');
row('Meta App ID (META_APP_ID)', has('META_APP_ID'), has('META_APP_ID') ? 'OAuth Facebook/Instagram possible' : 'Voir checklist Étape 6, section Meta');
row('Meta App Secret', has('META_APP_SECRET'), has('META_APP_SECRET') ? 'Signatures webhook vérifiées' : 'Voir checklist Étape 6, section Meta');
row('Token webhook Meta (META_VERIFY_TOKEN)', has('META_VERIFY_TOKEN'), has('META_VERIFY_TOKEN') ? 'Personnalisé' : 'Valeur par défaut de démo — changez-la');
row('Token WhatsApp (WHATSAPP_TOKEN)', has('WHATSAPP_TOKEN'), has('WHATSAPP_TOKEN') ? 'Envois WhatsApp réels possibles' : 'Nécessaire pour WhatsApp Business réel', false);
row('URI retour OAuth (META_REDIRECT_URI)', has('META_REDIRECT_URI'), has('META_REDIRECT_URI') ? env.META_REDIRECT_URI.replace(/\/\/[^/]+/, '//***') : 'Doit être https://VOTRE-DOMAINE/auth/meta/callback en production');

const keyOk = /^[0-9a-fA-F]{64}$/.test(env.TOKEN_ENCRYPTION_KEY || '');
row('Clé de chiffrement jetons (TOKEN_ENCRYPTION_KEY)', keyOk, keyOk ? 'AES-256-GCM prêt' : 'Générez-la : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');

row('Supabase URL', has('SUPABASE_URL'), has('SUPABASE_URL') ? 'Base cloud configurée' : 'Créez le projet puis exécutez supabase/schema.sql', false);
row('Supabase Service Role', has('SUPABASE_SERVICE_ROLE_KEY'), has('SUPABASE_SERVICE_ROLE_KEY') ? 'Présente (serveur uniquement !)' : 'Dans Supabase : Settings > API', false);
const sasKey = has('SASPAY_SECRET_KEY') || has('SASPAY_API_KEY');
row('Paiement SasPay (SASPAY_SECRET_KEY)', sasKey, sasKey ? ('SasPay actif, mode ' + (String(env.SASPAY_SECRET_KEY || env.SASPAY_API_KEY).startsWith('sk_live') ? 'LIVE' : 'TEST')) : 'Optionnel — alternative à Flutterwave (Mobile Money RDC/Afrique)', false);
row('Secret webhook SasPay', has('SASPAY_WEBHOOK_SECRET'), has('SASPAY_WEBHOOK_SECRET') ? 'Webhooks signés vérifiés' : 'À copier depuis app.saspay.me > Développeur > Webhooks (affiché une seule fois)', false);
row('Paiement Flutterwave (FLW_SECRET_KEY)', has('FLW_SECRET_KEY') || has('FLUTTERWAVE_SECRET_KEY'), (has('FLW_SECRET_KEY') || has('FLUTTERWAVE_SECRET_KEY')) ? 'Paiements réels actifs' : 'Mode simulation — créez un compte Flutterwave ou CinetPay');

const adminOk = has('ADMIN_KEY') && env.ADMIN_KEY !== 'pilote-admin-demo';
row('Code Admin personnalisé (ADMIN_KEY)', adminOk, adminOk ? 'Page /admin protégée par votre code' : '⚠️ OBLIGATOIRE avant mise en ligne : remplacez le code de démo');

row('TikTok commentaires (TIKTOK_CLIENT_KEY)', has('TIKTOK_CLIENT_KEY'), has('TIKTOK_CLIENT_KEY') ? 'Commentaires TikTok réels possibles (app approuvée requise)' : 'Optionnel — commentaires uniquement, pas de DM via API officielle', false);
const port = env.PORT || '3000';
console.log('\n🔍 PILOTE RÉSEAU — État de votre configuration\n');
for (const r of rows) {
  console.log(`${r.ok ? '✅' : (r.required ? '❌' : '⚠️ ')} ${r.service}\n   ${r.detail}`);
}
const missingRequired = rows.filter(r => !r.ok && r.required);
console.log('\n' + (missingRequired.length
  ? `🧪 Mode : DÉMO PARTIELLE — ${missingRequired.length} élément(s) requis manquant(s) pour le 100% réel.\n   Suivez PILOTE_RESEAU/06_Checklist_configuration_et_mise_en_ligne.md section par section.`
  : '🚀 Mode : PRODUCTION — tout est configuré. Bon lancement !'));
console.log(`   Serveur : port ${port} · Node ${process.version}\n`);
