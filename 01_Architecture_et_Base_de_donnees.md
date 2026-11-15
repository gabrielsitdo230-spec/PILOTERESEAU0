# PILOTE RÉSEAU — Étape 1 : Plan d'architecture & schéma de base de données

> **Objectif produit :** permettre à un débutant, commerçant ou entrepreneur (notamment en Afrique, connexion lente, mobile d'abord) d'avoir un assistant IA actif sur WhatsApp, Facebook et Instagram en **moins de 10 minutes**, sans aucune compétence technique.
>
> **Modèle simplifié :** 1 assistant IA par réseau → Mission → Test Playground → Connexion → Réponses automatiques 24h/24 en moins de 10 secondes.

---

## 1. Vue d'ensemble du système

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   WhatsApp      │     │   Facebook /    │     │   Instagram     │
│   Business API  │     │   Messenger     │     │   DM + Comment. │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │  Webhooks Meta (messages entrants)            │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │  API Node.js (Back)    │
                    │  - Vérif. signature    │
                    │  - File d'attente      │
                    │  - Anti-spam / cadence │
                    └───────┬────────┬───────┘
                            │        │
              ┌─────────────▼──┐  ┌──▼──────────────────┐
              │ Worker IA      │  │ Supabase            │
              │ - Contexte KB  │  │ - PostgreSQL        │
              │ - Appel LLM    │  │ - Auth              │
              │ - 1 crédit/msg │  │ - Storage (PDF)     │
              └─────────────┬──┘  │ - Row Level Security│
                            │     └──────────▲──────────┘
                            ▼                │
                    Réponse via API Meta     │
                                             │
                    ┌────────────────────────┴──────────┐
                    │  Front React + Tailwind         │
                    │  Dashboard · Inbox · Playground │
                    │  Mobile d'abord, français       │
                    └─────────────────────────────────┘
```

**Principe clé de sécurité :** les clés IA, les jetons Meta et les secrets de paiement ne vivent **que côté serveur**. Le front ne parle qu'à notre API et à Supabase (avec RLS).

---

## 2. Choix techniques (et pourquoi)

| Couche | Choix | Justification |
|---|---|---|
| **Front** | React + Vite + Tailwind CSS | Léger, rapide sur connexions lentes, énorme communauté |
| **Back** | Node.js (Fastify ou Express) + TypeScript | Même langage que le front, webhooks Meta simples |
| **Base de données** | Supabase (PostgreSQL + Auth + Storage) | Auth prête, RLS par utilisateur, fichiers PDF, gratuit pour démarrer |
| **File d'attente** | BullMQ + Redis (ou Supabase Queues au départ) | Traiter beaucoup de messages sans dépasser les 10 s, réessais automatiques |
| **IA** | API LLM côté serveur (modèle interchangeable via variable d'env.) | Aucune clé exposée, on peut changer de fournisseur sans toucher au front |
| **Réseaux** | API officielles Meta : WhatsApp Business Platform, Messenger Platform, Instagram Graph API | Conforme aux règles Meta, pas de bannissement lié aux outils non officiels |
| **WhatsApp QR (option)** | Passerelle QR séparée, désactivée par défaut | Avec avertissement clair : risque de restriction Meta, réservé aux tests |
| **Paiement** | Flutterwave (principal) / CinetPay (secours) | Orange Money, M-Pesa, Airtel Money, MTN MoMo + cartes Visa/Mastercard |
| **Hébergement** | Front : Vercel/Netlify · API : Render/Railway/Fly.io · DB : Supabase Cloud | Démarrage à coût quasi nul, montée en charge progressive |
| **i18n** | français par défaut, structure `locales/fr.json`, `en.json`… | Prêt pour anglais/portugais sans refonte |

---

## 3. Parcours utilisateur (le chemin des 10 minutes)

```
Inscription (email ou téléphone, 1 min)
   → Assistant guidé : 5 questions simples (activité, mission, ton, infos clés, horaires)
   → L'IA rédige seule les instructions de l'assistant
   → Étape 1 Créer · Étape 2 Mission · Étape 3 Playground (test immédiat, 0 crédit réel)
   → Étape 4 Connecter : [Connecter avec Facebook] (Facebook + Instagram) ou QR/API WhatsApp
   → ✅ Assistant actif — bandeau de confirmation + premier message de test
```

**Règles de simplicité appliquées partout :** 1 bouton principal par écran, 1 phrase d'aide, messages d'erreur = problème + solution (« Votre page Facebook n'est pas connectée. Cliquez sur Connecter — ça prend 30 secondes. »), aucun mot technique (on dit « crédits messages », jamais « tokens »).

---

## 4. Schéma de base de données (Supabase / PostgreSQL)

### 4.1 Tables principales

**`profiles`** — un utilisateur = un profil (lié à `auth.users`)
| Colonne | Type | Note |
|---|---|---|
| id | uuid PK | = auth.users.id |
| full_name, phone, country, language | text | language défaut `fr` |
| created_at | timestamptz | |

**`workspaces`** — espace de travail (v1 : 1 par utilisateur, extensible en équipe)
| id uuid PK · owner_id uuid FK→profiles · name text · created_at |

**`assistants`** — un assistant IA par réseau connecté
| Colonne | Type | Note |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| name | text | ex. « Boutique Amina — WhatsApp » |
| channel | enum | `whatsapp` \| `facebook` \| `instagram` |
| mission | enum | `repondre` \| `rdv` \| `qualifier` \| `support` \| `vente` \| `perso` |
| instructions | text | prompt système généré par l'assistant guidé, modifiable |
| tone | text | ex. « chaleureux, emojis modérés » |
| language | text | défaut `fr` |
| is_active | boolean | bouton Pause = `false` |
| handoff_enabled | boolean | passage à un humain |
| created_at / updated_at | timestamptz | |

**`connected_accounts`** — comptes réseaux reliés (jetons **chiffrés**)
| id · workspace_id · channel enum · external_id text (n° WhatsApp / Page ID / IG ID) · display_name text · access_token_encrypted text · token_expires_at · status enum (`connected`,`expired`,`error`) · UNIQUE(channel, external_id) |

**`knowledge_sources`** — base de connaissances
| id · workspace_id · assistant_id (nullable = partagée) · type enum (`text`,`pdf`,`url`,`faq`) · title · content text (extrait nettoyé) · file_path (Storage) · status enum (`processing`,`ready`,`error`) · created_at |

**`knowledge_chunks`** — morceaux découpés pour la recherche IA (RAG simple)
| id · source_id FK · workspace_id · content text · embedding vector(1536) *(option pgvector, activable en v1.1 — v1 : recherche par mots-clés + contexte tronqué)* |

**`conversations`** — fil unique tous réseaux (boîte de réception unifiée)
| id · workspace_id · assistant_id · channel · external_conversation_id · contact_external_id · contact_name · contact_phone · status enum (`open`,`human`,`closed`,`paused`) · assigned_to uuid nullable · last_message_at · unread_count int |

**`messages`**
| id · conversation_id FK · direction enum (`in`,`out`) · sender enum (`contact`,`ai`,`human`) · content text · external_message_id text UNIQUE (anti-doublon webhook) · credits_used int (0 ou 1) · status enum (`queued`,`sent`,`delivered`,`read`,`failed`) · created_at |

**`credit_accounts` & `credit_transactions`** — le portefeuille (jamais de solde négatif)
| credit_accounts: workspace_id PK · balance int · plan enum (`starter`,`pro`,`business`) · plan_expires_at |
| credit_transactions: id · workspace_id · amount int (+/-) · type enum (`purchase`,`message_sent`,`bonus`,`refund`,`plan_grant`) · reference text (id paiement) · created_at |

**`payments`**
| id · workspace_id · provider enum (`flutterwave`,`cinetpay`,`card`) · provider_ref text UNIQUE · amount numeric · currency text (XAF, XOF, CDF, USD…) · method text (orange_money, mpesa, momo, card…) · status enum (`pending`,`success`,`failed`) · credits_granted int · created_at |

**`plans`** (table de référence, modifiable sans code)
| code PK (`starter`,`pro`,`business`) · name · price_monthly · currency · credits_included int · max_assistants int · features jsonb |

**`handoff_alerts`** — alertes passage humain
| id · conversation_id FK · reason text · notified_via enum (`inapp`,`email`,`whatsapp_admin`) · is_read boolean · created_at |

**`usage_logs`** (optionnel, débogage & stats) : id · workspace_id · event · metadata jsonb · created_at

### 4.2 Sécurité des données — Row Level Security (RLS)

- **RLS activée sur 100 % des tables.** Politique unique : un utilisateur ne voit/modifie que les lignes de **son** workspace (`workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())`).
- Jetons Meta chiffrés en **AES-256-GCM** côté serveur avant insertion ; clé de chiffrement uniquement en variable d'environnement serveur.
- Webhooks : vérification de la signature `X-Hub-Signature-256` Meta, idempotence via `external_message_id UNIQUE` (un webhook reçu 2 fois = 1 seul message traité).
- Données clients **jamais** utilisées pour entraîner des modèles (mention contractuelle + aucun envoi à des fins d'entraînement).

### 4.3 SQL de création
Le script SQL complet et exécutable (tables, enums, index, RLS, fonction `consume_credit` atomique) sera livré à l'Étape 2 en même temps que l'interface, prêt à coller dans l'éditeur SQL Supabase.

---

## 5. API interne (aperçu)

| Route | Rôle |
|---|---|
| `POST /webhooks/meta` | Réception WhatsApp/Facebook/Instagram (vérification + signature + file d'attente) |
| `POST /api/assistants/guided-setup` | Les 5 questions → l'IA génère les instructions |
| `POST /api/playground/chat` | Test sans crédit réel et sans envoi réseau |
| `POST /api/conversations/:id/reply` | Réponse humaine depuis l'inbox unifiée |
| `POST /api/conversations/:id/pause` / `resume` | Bouton Pause par conversation ou assistant |
| `GET/POST /api/knowledge` | Ajout texte / PDF / lien, statut d'indexation |
| `POST /api/payments/checkout` | Démarre un paiement Flutterwave/CinetPay |
| `POST /webhooks/payments` | Confirmation paiement → crédit du compte (idempotent) |
| `GET /api/stats` | Messages, temps de réponse, crédits, taux de passage humain |

**Chaîne de traitement d'un message entrant (< 10 s) :** webhook → réponse `200` immédiate à Meta → file d'attente → déduplication → assistant actif ? → fenêtre 24 h Meta respectée ? → récupération connaissances → appel LLM → contrôle crédits (débit atomique) → envoi API Meta → sauvegarde + stats. En cas d'échec : 3 réessais avec délai croissant, puis alerte.

**Limites anti-bannissement Meta :** cadence d'envoi plafonnée par compte, variation légère des formulations, respect strict de la fenêtre de 24 h (hors fenêtre : uniquement modèles WhatsApp approuvés), bouton Pause global.

---

## 6. Plans tarifaires (structure proposée — prix à valider par vous)

| | **Starter** | **Pro** | **Business** |
|---|---|---|---|
| Crédits messages / mois | 500 | 2 500 | 10 000 |
| Assistants (réseaux) | 1 | 3 | Illimité raisonnable |
| Base de connaissances | Texte + 5 PDF | Illimitée | Illimitée + priorité |
| Boîte de réception unifiée | ✅ | ✅ | ✅ + multi-utilisateurs |
| Statistiques | Basiques | Avancées | Avancées + export |
| Support | Email | Prioritaire | Dédié |

*Règle métier : 1 message généré par l'IA = 1 crédit. Messages humains envoyés depuis l'inbox = 0 crédit. Playground = 0 crédit.*

---

## 7. Découpage en étapes de construction

| Étape | Livrable | État |
|---|---|---|
| **1** | Architecture + schéma BDD (ce document) | ⬅️ **En attente de votre OK** |
| **2** | Interface complète navigable (accueil, inscription, dashboard, création 4 étapes, Playground, inbox, connaissances, stats, crédits, paramètres) — données simulées | À venir |
| **3** | Logique assistant + Playground réel (appel IA côté serveur) | À venir |
| **4** | Connexion WhatsApp / Facebook / Instagram (OAuth Meta + webhooks) | À venir |
| **5** | Crédits + paiement Mobile Money / carte | À venir |
| **6** | Checklist de configuration pour vous (Meta Developers, clés API, passerelle, domaine) + mise en ligne | À venir |

---

## 8. Points à décider par vous (non bloquants pour l'Étape 2)

1. **Prix exacts** des 3 plans et devise principale (USD, XOF, XAF, CDF… ?)
2. **Nom de domaine** envisagé (ex. `pilotereseau.com`) — nécessaire seulement à l'Étape 4/6.
3. **WhatsApp QR** : activé dès le départ ou uniquement API officielle Meta au lancement ? *(recommandation : API officielle d'abord, QR en option « bêta » ensuite)*
4. **Fournisseur IA** préféré si vous en avez un, sinon je choisirai le meilleur rapport qualité/prix à l'Étape 3.

---
*Document Étape 1 — Pilote Réseau. En attente de validation (« OK ») pour passer à l'Étape 2 : l'interface.*
