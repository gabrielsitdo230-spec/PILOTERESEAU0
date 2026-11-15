# 🧪 Tester Pilote Réseau chez vous (5 minutes)

## Ce qu'il faut
- Un ordinateur avec **Node.js 18 ou plus** (téléchargement gratuit : nodejs.org — bouton vert LTS)
- Aucune autre installation. Aucune clé API pour tester.

## Lancer la plateforme
1. Décompressez le ZIP.
2. Ouvrez un terminal / invite de commandes dans le dossier `PILOTE_RESEAU/app`.
3. Tapez :
   ```
   node server/index.js
   ```
4. Ouvrez dans votre navigateur :
   - 🏠 Site + application cliente : **http://localhost:3000**
   - 🔐 Page Admin : **http://localhost:3000/admin** — code : `pilote-admin-demo`

## Parcours de test conseillé (10 min)
1. Sur le site, cliquez **« Créer mon assistant gratuit »** → vous entrez dans l'application.
2. **Créer un nouvel assistant** → choisissez WhatsApp → mission → répondez aux 5 questions.
3. **Playground** : demandez « La robe rouge coûte combien ? » (réponse tirée de la base de connaissances), puis « Vous vendez des motos ? » (l'assistant refuse d'inventer), puis « Je veux un humain ».
4. **Crédits** : choisissez un plan → Orange Money → paiement simulé confirmé par le serveur.
5. **Admin** (`/admin`, code ci-dessus) : onglet **Prix & Plans** → passez le Starter à 12 → retournez sur la page d'accueil du site : le prix a changé partout.
6. Admin → **Clients & Crédits** : donnez +100 crédits au client de démo.

## Vérifications automatiques (optionnel)
```
npm test        → 22 tests doivent passer
npm run check   → liste ce qu'il manque pour passer en production réelle
```

## Passer en réel ensuite
Suivez `06_Checklist_configuration_et_mise_en_ligne.md` : domaine, app Meta, clé IA, Flutterwave, Supabase, hébergement.

## Sur GitHub
Le dossier contient déjà un dépôt Git prêt. Pour le mettre sur votre dépôt `Pilote_reseau` :
soit glissez le contenu décompressé via « uploading an existing file » sur GitHub,
soit poussez-le avec un jeton d'accès temporaire (Contents: Read and write, ce dépôt uniquement).
