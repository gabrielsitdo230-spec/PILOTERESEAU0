# Pilote Réseau sur Cloudflare — Étape A (socle)

Ce dossier **n'affecte pas** l'application actuelle (`app/` continue de tourner en Node).
Il prépare : Worker + D1 `pilote-reseau-db` + KV, migrations SQL, déploiement GitHub → Cloudflare.

## 1. Créer les ressources (une seule fois, avec VOTRE compte Cloudflare)
```bash
cd cloudflare
npm install -D wrangler   # ou: npm i -g wrangler
npx wrangler login        # ouvre le navigateur : autorisez avec VOTRE compte

npx wrangler d1 create pilote-reseau-db        # copiez le database_id affiché
npx wrangler kv namespace create PILOTE_KV     # copiez l'id affiché
```
Collez ces deux identifiants dans `wrangler.jsonc` (emplacements `REMPLACER_PAR_...`).

## 2. Créer les tables
```bash
npx wrangler d1 migrations apply pilote-reseau-db --local    # test sur votre machine
npx wrangler d1 migrations apply pilote-reseau-db --remote   # vraie base Cloudflare
npx wrangler d1 execute pilote-reseau-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

## 3. Secrets (JAMAIS dans GitHub, JAMAIS dans wrangler.jsonc)
```bash
npx wrangler secret put ADMIN_KEY
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put LLM_API_KEY
npx wrangler secret put META_APP_SECRET
npx wrangler secret put SASPAY_SECRET_KEY
npx wrangler secret put SASPAY_WEBHOOK_SECRET
# … même principe pour les autres clés (voir .dev.vars.example pour la liste locale)
```

## 4. Essayer en local puis déployer
```bash
npx wrangler dev            # http://localhost:8787/worker/health
npx wrangler deploy         # met en ligne le socle (Étape A uniquement)
```

## 5. Déploiement continu GitHub → Cloudflare (Étape F)
Cloudflare Dashboard → Workers & Pages → Create → Connect to Git → choisir le dépôt
`PILOTERESEAU0`, dossier racine `cloudflare/`, commande de déploiement `npx wrangler deploy`.
La liaison se fait par l'écran d'autorisation Cloudflare (aucun mot de passe partagé).

## État des étapes
- [x] **A. Socle** : wrangler.jsonc, D1 + migrations, KV, Worker de santé
- [x] B. Couche données D1 + migration des JSON (sauvegarde d'abord)
- [x] C. Routes API dans le Worker (mêmes adresses que le serveur Node) — 19/19 tests locaux
  - Reste à activer avec les vrais identifiants (étape E) : envoi automatique des réponses via l'API Meta/TikTok (réception + stockage des webhooks déjà faits), file Queues, panneau Admin complet (l'état des connecteurs depuis les Secrets est fait)
- [ ] D. Frontend servi par le Worker (déjà configuré en assets)
- [ ] E. Tests complets (voir cahier des charges §11)
- [ ] F. Déploiement continu + production
- [ ] G. Documentation finale
