# 🔎 Contrôle avant branchement des API — réponse honnête

**Question : quand je brancherai les différentes API, tout sera-t-il fonctionnel ?**
**Réponse courte : le code est prêt et testé (65/65), mais NON, tout ne marchera pas par magie le jour du branchement.** Voici exactement pourquoi, fonction par fonction.

## ✅ Prêt et prouvé (marchera dès la clé branchée)
| Fonction | Preuve |
|---|---|
| Comptes clients (inscription/connexion, espaces séparés) | Test réel : inscription → messages offerts pour commencer gratuitement |
| Assistants enregistrés (créer, pause, supprimer) | Nouveau : testé en réel, retrouvés après création |
| Base de connaissances PDF + copier-coller | Test réel : l'assistant répond le prix contenu dans le PDF |
| Playground (test gratuit) | Répond depuis les savoirs du client |
| Crédits (1 message IA = 1 crédit, jamais négatif) | 65/65 tests |
| Paiements SasPay (54 pays, monnaie locale, prix de référence USD) | Testé avec un faux serveur conforme à la doc SasPay |
| Webhooks Meta/TikTok, réponses automatiques, file d'attente | Testés avec des webhooks simulés signés |
| Connecteurs Admin (coller une clé → actif tout de suite) | Test réel : fausse clé IA détectée par le vrai fournisseur |

Brancher une clé se fait dans **Admin privé → 🔌 Connecteurs API** (enregistrer + bouton Tester). Aucun redémarrage, aucun code à toucher.

## ⚠️ Ce qui dépend des fournisseurs (pas du code)
1. **Meta (WhatsApp/Facebook/Instagram)** : il faut créer l'application Meta, la faire **valider par Meta** (permissions messages), et relier un numéro WhatsApp Business. Sans validation Meta, la connexion « en un clic » ne peut pas aboutir — c'est la règle de Meta pour tout le monde.
2. **TikTok** : approbation de l'application par TikTok pour lire/répondre aux commentaires. Les **messages privés automatiques n'existeront jamais** (TikTok ne les ouvre pas) : l'assistant répond aux commentaires et renvoie vers WhatsApp.
3. **IA (LLM)** : une clé valide chez le fournisseur choisi. Sans clé, la plateforme répond en mode local de démonstration (limité).
4. **SasPay** : clé `sk_test_` pour essayer, puis `sk_live_` + secret webhook pour l'argent réel. Le client ne reçoit ses crédits **qu'après** confirmation signée + revérification que l'argent est arrivé chez SasPay.
5. **Adresse publique HTTPS** : Meta/TikTok/SasPay envoient les messages à vos adresses de rappel (`/webhooks/...`). Il faut donc un **nom de domaine + hébergement en ligne** : tant que la plateforme tourne en local, aucun vrai message client ne peut arriver.
6. **Supabase** : l'emplacement existe dans les Connecteurs, mais les données vivent encore dans des fichiers du serveur. À brancher pour la vraie production multi-clients (chantier prévu).

## 🎯 Ce qui a été simplifié pour les débutants
- Menu réduit à 6 entrées : Accueil, Assistants, Messages, Savoirs, Crédits, Réglages (page Statistiques retirée).
- Accueil public allégé : promesse, 3 étapes, prix (2 lignes par plan), 3 questions fréquentes. Fausse conversation de démonstration retirée.
- Faux boutons retirés (« Continuer avec Facebook » qui ne faisait rien, mode démo).
- Tableau de bord : 2 chiffres réels seulement (crédits, assistants) + 3 boutons.
- Fini les fausses données : assistants, conversations et historique de crédits affichent les **vraies** données du compte — ou un message simple « Aucune conversation pour le moment ».
- L'assistant créé dans l'assistant de création est **vraiment enregistré** ; son statut affiche honnêtement « ⚪ À connecter » tant que le réseau n'est pas branché (plus jamais de faux « connecté »).

## Ordre conseillé pour passer en vrai
1. Héberger + domaine HTTPS, définir `ADMIN_KEY` et `TOKEN_ENCRYPTION_KEY` forts.
2. Clé IA (le cerveau) → tester dans le Playground.
3. SasPay `sk_test_` → faire un achat test complet → puis `sk_live_`.
4. Application Meta (validation à lancer tôt, c'est le plus long) + TikTok.
5. Supabase, textes légaux adaptés, dépôt GitHub en privé.
