# 🚀 Pilote Réseau

Assistant IA pour **WhatsApp, Facebook, Instagram et TikTok (commentaires)** — pensé pour les débutants et entrepreneurs africains : mobile d'abord, français, réponses en moins de 10 secondes, 24h/24.

- **Interface** : page d'accueil, tableau de bord, création d'assistant en 4 étapes, Playground, boîte de réception unifiée, base de connaissances, statistiques, crédits, paramètres.
- **Page Admin** (`/admin`) : gestion complète de la plateforme — **prix des plans modifiables manuellement**, crédits clients, réseaux connectés, paiements.
- **Paiements** : Orange Money, M-Pesa, MTN MoMo, Airtel Money, cartes (Flutterwave/CinetPay).
- **Backend** : Node.js zéro dépendance, webhooks Meta signés, file d'attente, jetons chiffrés AES-256-GCM, schéma Supabase inclus.

## Démarrer

```bash
cd app
node server/index.js   # http://localhost:3000  ·  Admin : http://localhost:3000/admin
npm test               # 22 tests
npm run check          # état de votre configuration (clés manquantes ?)
```

Sans clés API, l'app tourne en mode démo intelligente. Guide complet de mise en production :
[`06_Checklist_configuration_et_mise_en_ligne.md`](06_Checklist_configuration_et_mise_en_ligne.md)

## Documents
- `01_Architecture_et_Base_de_donnees.md` — architecture
- `04_Connexion_reseaux.md` — Meta / WhatsApp / Instagram
- `05_Paiement_et_Admin.md` — paiements et page admin
- `legal/` — modèles politique de confidentialité + conditions d'utilisation
