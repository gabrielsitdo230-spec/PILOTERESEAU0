# Pilote Réseau — Étape 5 + Page Admin

## 🏷️ Modifier les prix manuellement (votre demande)

1. Ouvrez **`/admin`** (lien « Admin » : même adresse que le site + `/admin`).
2. Code admin de démo locale : `pilote-admin-demo` — **changez-le** dans `.env` (`ADMIN_KEY=votre-code`) avant la mise en ligne.
3. Onglet **« Prix & Plans »** : modifiez prix, devise (USD, CDF, XOF, XAF…), crédits inclus, assistants max, avantages → **Enregistrer**.
4. Le nouveau prix s'applique **immédiatement** : page d'accueil (tarifs), écran Crédits des clients, et montants des paiements. Aucun code à toucher.
5. Vous pouvez aussi **créer** un plan, le **masquer** (arrêter de le vendre) ou le **supprimer**.

## 🔐 Ce que la page Admin gère

| Onglet | Pouvoirs de l'admin |
|---|---|
| 📊 Vue d'ensemble | Clients, comptes connectés, messages traités, paiements, revenus, prix actuels |
| 🏷️ Prix & Plans | **Prix manuels**, création/masquage/suppression de plans |
| 👥 Clients & Crédits | Donner/retirer des crédits à la main, changer le plan d'un client, pause des assistants, suspendre/réactiver un compte |
| 🔗 Réseaux & Messages | Comptes WhatsApp/Facebook/Instagram connectés, derniers messages, santé de la file d'attente |
| 💰 Paiements | Historique complet, références, moyens (Orange Money, M-Pesa, MTN, Airtel, carte), crédits accordés |
| ⚙️ Système | État réel/démo de chaque service (Meta, IA, paiement, chiffrement) + ce qu'il manque comme clés |

Sécurité : toutes les routes `/api/admin/*` exigent l'en-tête `x-admin-key`. Sans le code, réponse 401.

## 💳 Paiements (Étape 5)

- `POST /api/payments/checkout` : crée une commande au **prix actuel défini par l'admin**, référence unique.
- Moyens : Orange Money, M-Pesa, MTN MoMo, Airtel Money, carte (`orange_money`, `mpesa`, `mtn_momo`, `airtel_money`, `card`).
- `POST /webhooks/payments` : confirmation fournisseur **idempotente** — même reçu 10 fois, les crédits ne sont ajoutés **qu'une fois** (prouvé par test).
- Sans clé Flutterwave : mode simulation (confirmation immédiate dans la démo). Avec la clé (`FLW_SECRET_KEY` dans `.env`) : bascule réelle, même code.
- À 0 crédit : l'assistant s'arrête proprement avec un message clair de recharge (Étape 3).

## Tests
`npm test` → **22/22** (assistant 6, Meta 8, paiements/admin 8), dont : prix modifié 24 → 29,50 appliqué au paiement, double confirmation sans double crédit, solde jamais négatif.
