# TikTok — automatisation des commentaires (ajout demandé)

## Ce qui est livré
- **Module `app/server/tiktok.js`** : OAuth TikTok (Login Kit), webhook commentaires signé, normalisation, réponse à un commentaire, modération.
- **Pipeline complet** : webhook TikTok → file d'attente → IA + base de connaissances → réponse publiée en commentaire → −1 crédit, anti-doublon.
- **Interface** : TikTok 🎵 dans « Créer un assistant », page d'accueil, boîte de réception (exemple marie.cd), Admin.
- **Modération** : commentaires sensibles (arnaque, remboursement, plainte…) → relecture humaine, jamais de réponse automatique.
- **Tests** : `test/test-tiktok.js` — 6/6. Total projet : 28/28.

## Limites officielles (transparence)
- TikTok via API officielle = **commentaires uniquement**. Les DM automatisés ne sont pas ouverts aux tiers : l'assistant invite donc le client à continuer sur WhatsApp pour commander.
- L'accès réel exige une **app TikTok approuvée** (developers.tiktok.com) : `TIKTOK_CLIENT_KEY/SECRET` dans `.env`. Sans clés : mode démo simulé, pipeline 100 % réel.

## Tester maintenant
```bash
curl http://localhost:3000/api/tiktok/status
curl -X POST http://localhost:3000/api/connect/simulate -H 'Content-Type: application/json' -d '{"channel":"tiktok"}'
curl -X POST http://localhost:3000/webhooks/tiktok -H 'Content-Type: application/json' \
  -d '{"event":"comment.create","content":"{\"comment_id\":\"tt1\",\"video_id\":\"v1\",\"text\":\"C est combien ?\",\"user\":{\"username\":\"@marie.cd\"}}"}'
curl http://localhost:3000/api/inbox/recent
```
