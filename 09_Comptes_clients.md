# Chantier 9 — Vrais comptes clients ✅

## Ce qui est livré
- `app/server/auth.js` : inscription, connexion, sessions (jeton Bearer, 30 jours, révocable à la déconnexion).
- Mots de passe **jamais en clair** : hachage scrypt + sel unique ; jetons de session stockés hachés.
- Chaque inscription crée un **workspace isolé** : crédits, base de connaissances, comptes réseaux et paiements séparés par client (prouvé par test : le client B ne voit rien du client A).
- **Messages offerts** à l'inscription (commencer gratuitement, nombre non affiché), plan Starter par défaut.
- Interface branchée : formulaires d'inscription/connexion réels, jeton conservé dans le navigateur, déconnexion réelle. Le bouton « Voir la démo sans compte » reste pour explorer.
- Sans session, les données privées répondent **401** (crédits, connaissances, historique de paiement).

## Tests
`test/test-auth.js` — 6/6. Total projet : **34/34**.

## Reste à faire pour ce chantier
- Brancher **Supabase Auth** à la place du stockage local quand vous aurez créé le projet Supabase (Étape 6) : les routes et l'interface ne changeront pas, seul `auth.js` sera remplacé par l'adaptateur Supabase.
- Mot de passe oublié par email/SMS (nécessite un fournisseur d'envoi).
