# Pilote Réseau — Application (Étape 3)

Assistant IA pour WhatsApp, Facebook, Instagram et TikTok (commentaires), pensé pour les débutants et entrepreneurs africains : mobile d'abord, français, réponses < 10 s, 24h/24.

## Lancer en local

```bash
cd PILOTE_RESEAU/app
node server/index.js
# Ouvrir http://localhost:3000
```

Aucune installation (`npm install` inutile : zéro dépendance, Node.js ≥ 18).

## Tester la logique

```bash
npm test
```

## Activer le vrai modèle d'IA

Sans clé, l'app tourne en **mode démo locale intelligente** : les réponses sont construites
à partir de la base de connaissances réelle (`data/knowledge.seed.json`), sans rien inventer.

Pour brancher un vrai modèle, créez un fichier `.env` (copie de `.env.example`) :

```
LLM_API_KEY=votre-cle-ici
LLM_MODEL=gpt-4o-mini
```

Redémarrez le serveur : `GET /api/health` affichera `"modeIA": "llm"`.
En cas de panne du fournisseur IA, repli automatique sur le moteur local (aucun client sans réponse).

## API

| Route | Rôle | Crédit |
|---|---|---|
| `GET /api/health` | État + mode IA | — |
| `POST /api/assistants/guided-setup` | 5 questions → instructions | 0 |
| `POST /api/playground/chat` | Test de l'assistant | 0 |
| `POST /api/chat` | Message réel | 1 si réponse IA |
| `GET/POST/DELETE /api/knowledge` | Base de connaissances | 0 |
| `GET /api/credits` | Solde + historique | — |

## Structure

```
app/
├── server/  index.js (API HTTP) · assistant.js (cerveau) · knowledge.js (recherche KB)
│            credits.js (portefeuille) · llm.js (fournisseur IA, clé serveur uniquement)
├── public/  index.html (interface Étape 2, Playground branché sur l'API)
├── data/    knowledge.seed.json (savoirs de démo) · fichiers générés à l'exécution
└── test/    test-assistant.js (6 tests automatisés)
```

## Prochaines étapes
- **Étape 4 ✅ (code livré)** : OAuth Meta, WhatsApp Business, webhooks signés, file d'attente, jetons chiffrés, `supabase/schema.sql`. Actif en réel dès vos clés (voir ../04_Connexion_reseaux.md).
- **Étape 5 ✅ + Admin** : prix modifiables manuellement dans `/admin` (code démo `pilote-admin-demo`, à changer via `ADMIN_KEY`), paiements Mobile Money/carte idempotents, gestion clients/crédits/réseaux. Voir ../05_Paiement_et_Admin.md.
- **Étape 6** : checklist de configuration + mise en ligne.
