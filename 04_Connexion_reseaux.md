# Pilote Réseau — Étape 4 : Connexion des 3 réseaux

## Ce qui est construit (code réel, prêt pour Meta)

| Brique | Fichier | État |
|---|---|---|
| OAuth « Connecter avec Facebook » (Facebook + Instagram, 7 permissions) | `app/server/meta.js` | ✅ Code réel, actif dès `META_APP_ID/SECRET` présents |
| Pages Facebook + comptes Instagram liés récupérés après OAuth | `meta.js → listPagesAndInstagram` | ✅ |
| WhatsApp Business : envoi via Graph API, fenêtre 24h, templates hors fenêtre | `meta.js → sendMessage/within24h` | ✅ |
| WhatsApp QR (option test) | Interface Étape 2/3 | ⚠️ Avertissement affiché ; passerelle QR à brancher séparément (Étape 6) |
| Webhooks : vérification `hub.challenge`, signature `X-Hub-Signature-256` | `server/index.js → /webhooks/meta` | ✅ Testé |
| Normalisation WhatsApp / Messenger / commentaires IG | `meta.js → normalizeWebhook` | ✅ Testé |
| File d'attente (concurrence 5, 3 réessais, anti-doublon) | `server/queue.js` | ✅ Testé |
| Jetons chiffrés AES-256-GCM | `server/meta-crypto.js` | ✅ Testé |
| Schéma Supabase complet + RLS + débit crédit atomique | `app/supabase/schema.sql` | ✅ À exécuter par vous (Étape 6) |
| Pipeline entrant : webhook → IA (base de connaissances) → réponse → −1 crédit | `server/index.js → incomingQueue` | ✅ Testé en direct |

## Mode démo vs mode réel

- **Aujourd'hui (sans vos clés Meta)** : `/api/meta/status` affiche `live: false`. Les boutons « Connecter » enregistrent un compte **simulé**, mais le pipeline complet fonctionne : envoyez un faux webhook WhatsApp et l'assistant répond (envoi simulé, journalisé).
- **Avec vos clés** (`META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_TOKEN`, `TOKEN_ENCRYPTION_KEY` dans `.env`) : OAuth réel, envois Graph API réels, signatures vérifiées. **Aucun changement de code.**

## Tester le pipeline maintenant

```bash
# 1. État
curl http://localhost:3000/api/meta/status

# 2. Connecter un compte (démo)
curl -X POST http://localhost:3000/api/connect/simulate -H 'Content-Type: application/json' -d '{"channel":"whatsapp"}'

# 3. Simuler un message client WhatsApp (webhook Meta)
curl -X POST http://localhost:3000/webhooks/meta -H 'Content-Type: application/json' -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"metadata":{"phone_number_id":"123"},"contacts":[{"wa_id":"243815000000","profile":{"name":"Marie"}}],"messages":[{"id":"wamid.test1","from":"243815000000","type":"text","text":{"body":"La robe rouge coûte combien ?"}}]}}]}]}'

# 4. Voir la réponse de l'IA partir
curl http://localhost:3000/api/inbox/recent
```

## Ce qu'il vous reste à fournir (détaillé à l'Étape 6)
1. Une app sur **Meta for Developers** (App ID + Secret) avec les produits WhatsApp, Messenger, Instagram.
2. L'URL webhook publique : `https://VOTRE-DOMAINE/webhooks/meta` + le token de vérification choisi.
3. Un numéro WhatsApp Business (ou le numéro de test Meta pour commencer).
4. `TOKEN_ENCRYPTION_KEY` : 64 caractères hexadécimaux (commande fournie à l'Étape 6).
