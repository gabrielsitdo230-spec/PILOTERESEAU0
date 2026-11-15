# SasPay — connexion de la plateforme (paiements Mobile Money & cartes)

SasPay couvre la **RDC (pays CD, devise CDF)** et une grande partie de l'Afrique : Orange Money, M-Pesa, MTN, Airtel, Wave, cartes. Documentation officielle : https://docs.saspay.me

## Ce qui est branché dans le code
- `app/server/saspay.js` : client API officiel (checkout hébergé), vérification de statut, **webhook signé HMAC-SHA256 + anti-rejeu 5 minutes**.
- Au paiement d'un plan : création d'une **session de checkout SasPay** → le client paie sur la page SasPay (il choisit son réseau) → retour automatique → la plateforme **revérifie le statut réel chez SasPay** avant d'ajouter les crédits (jamais sur parole), une seule fois (idempotent).
- Le webhook `/webhooks/saspay` (signé) déclenche aussi la confirmation dès que SasPay notifie `transaction.success`.
- Sans clé : la plateforme reste en **simulation**. Dès que la clé est là : SasPay devient le fournisseur actif (visible dans Admin → Système et Admin → Paiements).

## Ce que VOUS devez faire (10 minutes + validation du compte)
1. Créez votre compte marchand sur **app.saspay.me**, complétez la vérification demandée.
2. **Développeur → Clés API** : créez une clé **SANDBOX** (`sk_test_...`, pour tester sans argent réel), copiez-la.
3. Dans le fichier `.env` du serveur (ou les variables de l'hébergeur) :
   ```
   SASPAY_SECRET_KEY=[SECURITY_DATA] clé sandbox, puis sk_live_... en production>
   SASPAY_COUNTRY=CD
   PUBLIC_BASE_URL=https://votre-domaine
   ```
4. **Développeur → Webhooks** : créez un point de réception :
   - URL : `https://votre-domaine/webhooks/saspay`
   - Événement : `transaction.success` (ajoutez `transaction.failed` si proposé)
   - **Copiez le secret de signature immédiatement (affiché une seule fois)** → `SASPAY_WEBHOOK_SECRET=...` dans `.env`.
5. Redémarrez le serveur → `npm run check` doit afficher SasPay actif (mode TEST), et Admin → Système : « Fournisseur actif : saspay ».
6. Testez : inscrivez un compte client → Crédits → choisissez Starter (2 $) → la page SasPay s'ouvre → payez en sandbox → les 500 crédits arrivent tout seuls.
7. Quand tout est bon : remplacez par la clé **LIVE** (`sk_live_...`) et le webhook LIVE correspondant.

## Notes importantes
- **Devise** : vos prix sont en USD. Si votre portefeuille SasPay encaisse en CDF, passez vos plans en CDF depuis l'Admin (Prix & Plans → devise CDF, montants équivalents) — SasPay débitera dans la devise du plan.
- Frais SasPay : à partir d'environ 1,75 % + frais fixes selon le pays/réseau (voir saspay.me, section Tarifs) — pensez-y dans vos prix.
- Ne mettez JAMAIS la clé `sk_...` dans le navigateur ou sur GitHub : elle vit uniquement dans `.env` côté serveur.

## 🌍 Pays, devises et validation stricte (ajout propriétaire)
- **Prix toujours en USD** (2/5/10/25/59 $). Au paiement, le client **choisit son pays parmi 54 pays africains** : s'il est couvert par SasPay (18 pays), le débit se fait dans **sa devise locale** au taux indicatif de `app/server/countries.js` (ex. Starter en RDC : 2 $ ≈ 5 500 CDF). Sinon : carte en USD.
- **Validation UNIQUEMENT sur signal SasPay** : l'écran du client ne fait qu'afficher l'attente (lecture seule, aucun crédit). Les crédits sont accordés seulement quand le **webhook signé** arrive ET que le serveur a **revérifié le statut réel** de la session auprès de l'API SasPay.
- **Annulation catégorique** : si SasPay signale un échec/une annulation (revérifié), le paiement passe à `cancelled`, **0 crédit**, et le client voit : « L'achat n'a pas abouti : le paiement a été annulé chez SasPay. Aucun crédit ajouté. Veuillez reprendre l'achat. » L'admin voit « 🚫 Annulé chez SasPay » et le montant débité par pays.
