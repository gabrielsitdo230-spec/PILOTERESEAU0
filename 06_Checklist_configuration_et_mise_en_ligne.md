# Pilote Réseau — Étape 6 : Checklist de configuration & mise en ligne

> **Votre seule partie du travail.** Le code est terminé et testé (22/22). Chaque section ci-dessous = un compte à créer + une clé à copier dans le fichier `.env` du serveur. Dans l'ordre, comptez **une demi-journée** la première fois (les délais Meta peuvent ajouter 1 à 5 jours d'attente de validation).
>
> ✅ Vérifiez à tout moment où vous en êtes : dans `app/`, lancez **`npm run check`**.

---

## ☐ 1. Choisir le nom de domaine (30 min)

- Achetez un domaine simple, par ex. `pilotereseau.com` ou `pilote-reseau.com` (registrars : Cloudflare Registrar, Namecheap, Hostinger… ~10–15 $/an).
- Vous en aurez besoin pour : l'adresse du site, le webhook Meta (**HTTPS obligatoire**), l'URI de retour OAuth.
- ⏳ Vous pouvez tout tester avant avec l'URL gratuite de l'hébergeur (section 6), puis brancher le domaine à la fin.

## ☐ 2. Créer l'application Meta (Facebook / Instagram / WhatsApp) — LE PLUS LONG

1. Allez sur **developers.facebook.com** → connectez-vous avec le compte Facebook qui administrera l'entreprise → **My Apps → Create App** → type **Business** → nom : `Pilote Réseau`.
2. Notez dans `.env` : `META_APP_ID` et `META_APP_SECRET` (Settings → Basic → App Secret → Show).
3. Ajoutez les produits : **WhatsApp**, **Messenger**, **Instagram** (Set up sur chacun).
4. **WhatsApp → API Setup** : récupérez le numéro de test fourni par Meta + un jeton temporaire → `WHATSAPP_TOKEN`. Pour un vrai numéro : ajoutez votre numéro professionnel (il ne doit pas déjà être sur WhatsApp classique ; une carte SIM dédiée est idéale).
5. **Facebook Login → Settings** : dans *Valid OAuth Redirect URIs*, ajoutez exactement :
   `https://VOTRE-DOMAINE/auth/meta/callback` → reportez la même valeur dans `META_REDIRECT_URI`.
6. **Webhooks** (dans chaque produit, ou App → Webhooks) :
   - Callback URL : `https://VOTRE-DOMAINE/webhooks/meta`
   - Verify Token : inventez un mot secret (ex. `pr-` + une suite aléatoire) → mettez **la même valeur** dans `META_VERIFY_TOKEN`.
   - Abonnez les champs : `messages` (WhatsApp / Messenger / Instagram), et `comments` pour les commentaires Instagram.
   - ✔️ Test rapide : notre serveur répond au `hub.challenge` (prouvé Étape 4).
7. **Permissions à demander** (App Review, si vous dépassez le mode test) : `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `business_management`, + accès WhatsApp du numéro. Préparez une courte vidéo montrant : connexion d'une Page → message client → réponse IA (vous pouvez l'enregistrer avec la démo actuelle).
8. Cliquez **Publish / Passer en mode Live** quand l'App Review est acceptée.

⚠️ **Règles Meta à respecter dès le jour 1** (déjà intégrées au code) : répondre dans la fenêtre de 24 h, utiliser uniquement des **modèles (templates) approuvés** pour relancer un client WhatsApp hors fenêtre, ne jamais spammer, bouton Pause visible. La connexion **QR non officielle** reste un outil de test : ne la proposez pas comme méthode principale à vos clients payants (risque de restriction du numéro).

## ☐ 2bis. TikTok — commentaires automatiques (optionnel, app TikTok à faire approuver)

1. **developers.tiktok.com** → Create app → récupérez `TIKTOK_CLIENT_KEY` et le secret associé → `.env` (+ `TIKTOK_REDIRECT_URI=https://VOTRE-DOMAINE/auth/tiktok/callback`, même URI déclarée chez TikTok).
2. Demandez les accès commentaires (`comment.list`, `comment.edit`) et le webhook sur `https://VOTRE-DOMAINE/webhooks/tiktok` (secret : `TIKTOK_WEBHOOK_SECRET`).
3. ⚠️ **Limites officielles TikTok** : commentaires = oui (app approuvée) ; **messages privés automatisés = non disponibles** via l'API publique. Vendez TikTok comme « réponses automatiques sous vos vidéos », et redirigez vers WhatsApp pour conclure la vente (c'est ce que fait la réponse-type de démo).
4. Comme Meta, TikTok exige une **revue de l'app** : prévoyez la vidéo de démonstration du flux commentaire → réponse IA.

## ☐ 3. Brancher le vrai modèle d'IA (10 min)

1. Créez un compte chez un fournisseur d'IA (ex. OpenAI) et générez une **clé API**.
2. `.env` : `LLM_API_KEY=votre-cle` et gardez `LLM_MODEL=gpt-4o-mini` (valeur par défaut du code).
3. Redémarrez → `npm run check` doit afficher ✅ sur la ligne IA. Le Playground et WhatsApp répondront alors avec le vrai modèle ; en cas de panne fournisseur, repli automatique sur le moteur local (aucun client sans réponse).
4. 💰 Surveillez le coût : avec `gpt-4o-mini`, une réponse courte coûte une fraction de centime — votre marge sur 1 crédit est confortable aux prix actuels.

## ☐ 4. Générer la clé de chiffrement des jetons (1 min)

Sur le serveur :
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Collez le résultat (64 caractères) dans `TOKEN_ENCRYPTION_KEY`. **Ne la perdez jamais et ne la changez jamais après des connexions réelles** (elle déchiffre les jetons de vos clients). Sauvegardez-la dans un gestionnaire de mots de passe.

## ☐ 5. Protéger la page Admin (1 min — OBLIGATOIRE)

`.env` : `ADMIN_KEY=` + un code long et unique (différent de vos autres mots de passe). Fini le code de démo `pilote-admin-demo`. L'admin se connecte ensuite sur `https://VOTRE-DOMAINE/admin` avec ce code.

## ☐ 6. Paiement Mobile Money / cartes (1–3 jours d'activation compte)

**Option recommandée : Flutterwave** (Orange Money, M-Pesa, MTN, Airtel selon pays + cartes).
1. Créez un compte **flutterwave.com** (ou **cinetpay.com** si vos pays sont mieux couverts), complétez la vérification d'entreprise (RCCM/pièce d'identité selon pays).
2. Récupérez la **clé secrète** → `FLW_SECRET_KEY` dans `.env` (`CINETPAY_*` si CinetPay).
3. Dans le dashboard du fournisseur, configurez le **webhook** : `https://VOTRE-DOMAINE/webhooks/payments` (notre endpoint est idempotent : prouvé, pas de double crédit).
4. Faites un paiement test de petit montant, vérifiez dans Admin → Paiements, puis demandez le passage en **mode Live** au fournisseur.

## ☐ 7. Base de données Supabase (20 min, recommandé en production)

1. Créez un projet sur **supabase.com** (région proche de vos clients, ex. EU West).
2. **SQL Editor** → collez tout `app/supabase/schema.sql` → **Run**. (Tables, RLS « chacun ne voit que ses données », fonction de débit de crédit atomique — déjà écrits pour vous.)
3. `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (Settings → API) dans `.env`. ⚠️ La clé *service_role* ne doit **jamais** quitter le serveur.
4. Aujourd'hui l'app tourne sur fichiers locaux (`app/data/`) : parfait pour démarrer et valider. Branchez Supabase quand vous dépassez quelques dizaines de clients actifs, ou avant tout hébergement multi-serveurs.

## ☐ 8. Héberger et mettre en ligne (30–60 min)

**Option simple (fichiers fournis) : Render ou Railway**
1. Poussez le dossier `app/` sur un dépôt GitHub privé.
2. Render → New → **Blueprint** (le fichier `render.yaml` fourni crée le service) — ou déployez le `Dockerfile` fourni sur Railway/Fly.io.
3. Dans le dashboard de l'hébergeur, remplissez **toutes les variables** `.env` (ce sont les « secrets » du panneau `render.yaml`), surtout `ADMIN_KEY` et `TOKEN_ENCRYPTION_KEY`.
4. Branchez votre domaine (section 1) sur le service + attendez le certificat HTTPS automatique.
5. Mettez à jour chez Meta : webhook + URI OAuth avec le **vrai domaine en https** (section 2, points 5–6).
6. **Tour de contrôle final** :
   - `https://VOTRE-DOMAINE/api/health` → `{"ok":true,...}`
   - `npm run check` sur le serveur → 🚀 PRODUCTION
   - Connectez **votre** Page Facebook de test → envoyez-vous un message → l'IA répond en < 10 s
   - Achetez le plus petit plan avec votre propre Mobile Money → crédit visible dans l'Admin
   - Changez un prix dans l'Admin → vérifiez la page d'accueil

## ☐ 9. Légal & confiance (avant de vendre)

- Publiez les deux documents fournis : `legal/Politique_de_confidentialite.md` et `legal/Conditions_utilisation.md` (adaptez : nom légal, pays, email de contact, prix).
- Ajoutez-les en lien dans le pied de page du site.
- Points déjà respectés par le code et à garder : données clients jamais utilisées pour entraîner des modèles, jetons chiffrés, chaque client isolé (RLS), export/suppression de compte sur demande à traiter sous 30 jours.

## ☐ 10. Exploitation quotidienne

| Quoi surveiller | Où |
|---|---|
| Revenus, paiements échoués | Admin → 💰 Paiements |
| Clients à court de crédits | Admin → 👥 Clients (trie mental : soldes bas) |
| File d'attente / échecs d'envoi | Admin → 🔗 Réseaux & Messages |
| Coût IA vs crédits vendus | Dashboard fournisseur IA + Admin |
| Sauvegardes | Hébergeur + export Supabase hebdomadaire |

---

## 🗂️ Récapitulatif de TOUT ce qui vous appartient

| # | Élément | Où l'obtenir | Variable `.env` |
|---|---|---|---|
| 1 | Domaine | Cloudflare / Namecheap / Hostinger | (DNS hébergeur) |
| 2 | App Meta + Secret | developers.facebook.com | `META_APP_ID`, `META_APP_SECRET` |
| 3 | Token webhook inventé par vous | (votre choix) | `META_VERIFY_TOKEN` |
| 4 | URI OAuth | `https://domaine/auth/meta/callback` | `META_REDIRECT_URI` |
| 5 | Token WhatsApp | Meta → WhatsApp → API Setup | `WHATSAPP_TOKEN` |
| 5b | App TikTok (optionnel) | developers.tiktok.com | `TIKTOK_CLIENT_KEY/SECRET` |
| 6 | Clé IA | Fournisseur IA | `LLM_API_KEY` |
| 7 | Clé de chiffrement | Commande section 4 | `TOKEN_ENCRYPTION_KEY` |
| 8 | Code admin secret | (votre choix) | `ADMIN_KEY` |
| 9 | Clé paiement | Flutterwave ou CinetPay | `FLW_SECRET_KEY` |
| 10 | Projet Supabase | supabase.com + `schema.sql` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| 11 | Hébergement | Render / Railway / Fly.io | (panneau hébergeur) |

**🎉 Une fois ces 11 lignes remplies : votre Pilote Réseau est un vrai SaaS en production.**
