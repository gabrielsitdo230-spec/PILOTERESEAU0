# 📚 Base de connaissances — PDF + copier-coller (fait)

## Ce qui existe
Dans l'écran **« 📚 Savoirs »** (Base de connaissances), chaque client garde les documents de **son** entreprise. Son assistant répond uniquement avec ces informations. Deux emplacements d'ajout, au choix :

### 📄 Place n°1 — Déposer un PDF
- Le client choisit son fichier (catalogue, liste de prix…) — maximum 6 Mo.
- La plateforme **lit le texte du PDF** (`app/server/pdf.js`, zéro dépendance : flux FlateDecode décompressés avec le zlib intégré à Node) et l'assistant l'apprend immédiatement.
- Si le PDF est une **image scannée sans texte** : message clair + solution (« copiez-collez le texte dans la place n°2 »). Un fichier non-PDF est refusé catégoriquement.

### ✍️ Place n°2 — Copier-coller un texte (sans PDF)
- Titre + grande zone de texte : le client écrit ou colle ses prix, horaires, conditions… **aucun PDF nécessaire**.
- Même traitement que le PDF : découpage en extraits recherchables, utilisé par l'assistant.

## Règles
- Chaque entreprise ne voit **que ses documents** (espace séparé, vérifié par test + en réel).
- Liste réelle : type (📄 PDF / ✍️ Texte), titre, nombre de caractères appris, statut ✅ Prêt, suppression réelle (l'assistant « oublie »).
- Erreurs toujours en français simple : **problème + solution**.

## Technique
- `POST /api/knowledge` (texte collé), `POST /api/knowledge/pdf` (fichier en base64, ≤ 6 Mo, vérification `%PDF`, extraction), `GET /api/knowledge`, `DELETE /api/knowledge/:id` — tous protégés par la session du client.
- Tests : `test/test-knowledge.js` (6) — extraction d'un vrai PDF compressé, refus non-PDF, recherche, réponse de l'assistant depuis le PDF, isolation des espaces. **Total plateforme : 60/60.**
- Vérifié en réel : inscription → collage → envoi PDF → l'assistant répond le prix contenu dans le PDF.
