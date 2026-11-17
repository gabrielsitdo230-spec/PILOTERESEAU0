# Connecteurs API — les emplacements des clés (Admin privé)

## Où c'est
**`/admin` → onglet « 🔌 Connecteurs API »** (propriétaire uniquement, session sécurisée).

## Les 5 emplacements créés
| Connecteur | Champs à remplir | Où obtenir les clés |
|---|---|---|
| 🔵 **Meta** (WhatsApp · Facebook · Instagram) | App ID, App Secret, Token de vérification webhook, Token WhatsApp, URI OAuth | developers.facebook.com → votre app |
| 🎵 **TikTok** (commentaires) | Client Key, Client Secret, URI OAuth, Secret webhook | developers.tiktok.com |
| 🧠 **IA** | Clé API, adresse API, modèle | votre fournisseur IA |
| 💳 **SasPay** | Clé secrète `sk_test_/sk_live_`, secret du webhook, pays, adresse publique | app.saspay.me → Développeur |
| 🗄️ **Supabase** | URL du projet, clé anon, clé service_role | supabase.com → Settings → API |

## Fonctionnement
- **Enregistrer** : la clé est chiffrée (AES-256 si `TOKEN_ENCRYPTION_KEY` est définie dans `.env`, sinon l'Admin affiche une alerte « clés de test uniquement ») et **activée immédiatement, sans redémarrer le serveur**.
- **Tester** : chaque connecteur a un vrai test — Meta interroge l'API Graph (nom de votre app), l'IA interroge le fournisseur, SasPay vérifie la clé, Supabase vérifie que le projet répond. Une mauvaise clé est refusée avec un message clair.
- **Masquage permanent** : l'Admin affiche `sk_l••••••••ab`, jamais le secret. Bouton **Effacer** par champ.
- **Adresses à copier** : l'onglet affiche les URLs exactes à déclarer chez chaque fournisseur (webhooks Meta/TikTok/SasPay, retours OAuth) avec bouton 📋 Copier.
- Priorité des valeurs : **Admin (connecteurs) > fichier `.env`**. Les deux peuvent coexister.

## Preuves (tests)
`test/test-connectors.js` — 7/7 : enregistrement, relecture par les modules, masquage, activation Meta immédiate sans redémarrage, effacement propre. **Total projet : 54/54 tests.**
Vérifié en direct : enregistrement d'une clé IA → module IA actif aussitôt → test de connexion → la fausse clé est refusée proprement (HTTP 401 du fournisseur) → effacement → module désactivé.

## Sécurité
- Routes `/api/admin/connectors/*` : session propriétaire obligatoire (401 sinon, vérifié).
- Aucun secret ne transite en clair vers le navigateur, aucun secret sur GitHub (fichier `data/connectors.json` ignoré par Git).
- Avant la production : définissez `TOKEN_ENCRYPTION_KEY` (checklist Étape 6) pour le chiffrement AES-256 des clés stockées.
