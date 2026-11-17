# 🔎 Rapport d'analyse — Migration Pilote Réseau vers Cloudflare
*Analyse réalisée AVANT toute modification de code, conformément au cahier des charges. Aucune migration lancée.*

## 1. Architecture actuelle (constat)
| Élément | État réel |
|---|---|
| Langage / runtime | **Node.js ≥ 18, JavaScript, zéro dépendance externe** (aucun framework) |
| Backend | `app/server/index.js` (629 lignes) : serveur HTTP natif `http.createServer`, routage manuel, ~40 routes API |
| Frontend | 1 fichier `app/public/index.html` (928 lignes, design actuel) + page Admin privée `app/private/admin.html` |
| Base de données | **Fichiers JSON locaux** dans `app/data/` (users, assistants, knowledge, credits, payments, plans, store, connectors) écrits via `fs.writeFileSync` par **9 modules serveur** |
| Auth | Maison : jetons de session, mots de passe hachés (sel + hachage, jamais en clair), espaces de travail (`workspaceId`) par client |
| Paiements | SasPay (webhook signé HMAC + revérification API, 54 pays) ; Flutterwave en réserve |
| IA | Fournisseur compatible OpenAI via `fetch` (clé serveur uniquement) |
| Réseaux | Meta (WhatsApp/Facebook/Instagram : OAuth, webhooks signés, envoi), TikTok (commentaires uniquement) |
| Sécurité | Tokens sociaux chiffrés AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), Admin privé par code + cookie HttpOnly, signatures webhooks vérifiées |
| Tests | **65/65 tests automatisés** verts (`npm test`) |
| Déploiement actuel | Préparé pour Render (`render.yaml`, `Dockerfile`) — pas encore en ligne |

## 2. Variables d'environnement nécessaires
`ADMIN_KEY`, `TOKEN_ENCRYPTION_KEY`, `LLM_API_KEY/BASE_URL/MODEL`, `META_APP_ID/SECRET`, `META_VERIFY_TOKEN`, `META_REDIRECT_URI`, `WHATSAPP_TOKEN`, `TIKTOK_CLIENT_KEY/SECRET`, `TIKTOK_REDIRECT_URI`, `TIKTOK_WEBHOOK_SECRET`, `SASPAY_SECRET_KEY`, `SASPAY_WEBHOOK_SECRET`, `SASPAY_COUNTRY`, `PUBLIC_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ces 2 derniers deviendront inutiles après migration D1), `PORT`.
→ Sur Cloudflare, elles deviendront des **Secrets Workers** (`wrangler secret put`), jamais dans GitHub.

## 3. ⚠️ Incompatibilités précises avec Cloudflare Workers (le point crucial)
Workers n'est **pas** un serveur Node classique. Concrètement :
1. **`fs` (lecture/écriture de fichiers) n'existe pas** sur Workers → les 9 modules qui persistent en JSON **ne peuvent pas fonctionner tels quels**. C'est LE chantier principal : les remplacer par D1.
2. **`http.createServer` n'existe pas** → le routage doit être réécrit au format Worker (`export default { fetch(req, env) }`). Travail mécanique mais complet sur `index.js`.
3. **Pas de processus permanent** : la file d'attente en mémoire (`queue.js`) et les compteurs en RAM disparaissent entre deux requêtes → à remplacer par **Cloudflare Queues** ou un traitement direct + D1.
4. **Limites d'exécution** : un Worker répond vite puis s'arrête (pas de tâche de fond longue). Les appels IA/Meta/SasPay en `fetch` sont compatibles, mais doivent rester courts et idempotents.
5. **Crypto** : `crypto` Node est partiellement disponible via le drapeau `nodejs_compat` (AES-GCM et HMAC y fonctionnent via WebCrypto) → le chiffrement des tokens et la vérification des signatures sont **adaptables**, à retester un par un.
6. **`zlib` (lecture PDF)** : non garanti sur Workers → l'extraction PDF actuelle (`server/pdf.js`) devra passer par une alternative (décompression via `DecompressionStream` du runtime, à valider par test réel).
7. **Logo/fichiers statiques** : servis aujourd'hui par le serveur → à servir via **Workers Static Assets** (inclus) ; les documents clients (PDF) pourront aller sur **R2** plus tard si besoin.

## 4. Architecture cible recommandée (simple, sans complexité inutile)
| Service demandé | Décision | Justification |
|---|---|---|
| **Workers** | ✅ Oui | Héberge l'API + les pages (Static Assets) |
| **D1 `pilote-reseau-db`** | ✅ Oui | Remplace les JSON : utilisateurs, assistants, savoirs, crédits, paiements, messages, comptes sociaux, paramètres |
| **KV** | ✅ Oui, petit rôle | Configurations publiques (plans/prix mis en cache), jetons de vérification temporaires. *Optionnel au départ.* |
| **R2** | ⏸️ Plus tard | Utile quand les clients déposeront beaucoup de PDF/images. Au départ, le texte extrait suffit en D1. |
| **Durable Objects** | ❌ Non (pour l'instant) | Aucun besoin réel : pas de temps réel collaboratif. L'ajouter maintenant = complexité inutile (contraire à votre consigne). Réévaluable si files d'attente temps réel un jour. |
| **Queues** | ✅ À la place de `queue.js` | File officielle Workers pour traiter les webhooks entrants de façon fiable |

**Schéma D1** : le schéma Supabase existant (`app/supabase/schema.sql`, 12 tables : profiles, workspaces, assistants, connected_accounts, knowledge_sources, conversations, messages, plans, credit_accounts, credit_transactions, payments, handoff_alerts) est une **excellente base** : à traduire en dialecte SQLite/D1 (types, `AUTOINCREMENT`, pas de RLS → la sécurité se fait dans le code du Worker, par `workspaceId` vérifié à chaque requête).

## 5. Ce qui ne changera pas
Design et écrans (aucune modification visuelle), parcours client, prix, règles SasPay (crédit seulement après confirmation), connecteurs Admin (les clés iront dans les Secrets Workers, avec le même écran), 65 tests existants (adaptés, pas supprimés).

## 6. Risques identifiés
- Webhooks Meta/TikTok/SasPay : doivent répondre en < quelques secondes sur Workers → accuser réception (200) puis traiter via Queues.
- Sessions Admin et clients : à stocker en D1/KV (plus de mémoire RAM partagée).
- Migration des données JSON actuelles : script de conversion JSON → SQL fourni, **avec sauvegarde préalable** (les fichiers `app/data/` ne seront jamais détruits).

## 7. Plan d'exécution proposé (par étapes, avec votre OK entre chaque)
1. **Étape A — Socle Cloudflare** : `wrangler.jsonc`, base D1 `pilote-reseau-db`, migrations SQL (traduction du schéma), environnement dev. *(aucun impact sur l'app actuelle)*
2. **Étape B — Couche données** : module d'accès D1 reproduisant exactement les fonctions actuelles (auth, assistants, savoirs, crédits, paiements, messages) + script de migration des JSON (sauvegarde d'abord).
3. **Étape C — Backend Worker** : réécriture du routage au format Worker, mêmes routes, mêmes réponses ; webhooks via Queues ; tests adaptés.
4. **Étape D — Frontend inchangé** servi en Static Assets ; Admin privé conservé.
5. **Étape E — Tests complets** (les 11 points de votre cahier des charges) en environnement de préproduction.
6. **Étape F — Déploiement** + branchement GitHub → Cloudflare (déploiement continu), secrets renseignés hors GitHub.
7. **Étape G — Documentation** : architecture finale, variables, maintenance — et **l'ancienne version Node reste intacte** en secours tant que tout n'est pas validé.

## 8. Ce qu'il vous faudra fournir le moment venu
Un compte **Cloudflare** (gratuit pour démarrer) et l'accès au dépôt GitHub pour le déploiement continu. Aucun mot de passe ne doit être partagé : la liaison GitHub↔Cloudflare se fait par l'écran d'autorisation de Cloudflare.

---
**En attente de votre validation pour démarrer l'Étape A.** Aucune modification de code n'a été faite pendant cette analyse.
