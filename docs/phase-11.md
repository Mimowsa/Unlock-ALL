# Phase 11 — Préparation Vercel / Neon

## État

Le code est préparé pour héberger la **maquette**, avec PostgreSQL Neon, des images dans un store Vercel Blob privé et des routes de tâches de fond authentifiées. PayPal reste limité au Sandbox et les emails Resend restent limités au destinataire de test autorisé. Le paiement Sandbox et l'affichage des clés au retour ont été confirmés par l'utilisateur après la phase 10.

Cette préparation ne crée aucun service externe et ne transforme pas la maquette en boutique commerciale. Les connexions réelles Neon/Blob, les notifications HTTPS et les déclenchements du planificateur doivent être vérifiés une fois les comptes/projets reliés.

## Fichiers et commandes ajoutés

- `.env.vercel.example` : variables du site hébergé, sans secret réel.
- `vercel.json` : compilation Vercel, région Paris, planification externe.
- `deployment/vercel.pro.json` : variante avec deux tâches Vercel chaque minute, à utiliser uniquement si l'offre choisie le permet.
- `.vercelignore` et `.gitignore` : exclusion des secrets, fichiers locaux et résultats de tests.
- `npm run deploy:check` : contrôle de configuration sans connexion distante ; seules des erreurs génériques sont affichées.
- `npm run deploy:database` : préparation du rôle de la base de démonstration Neon (UTC et schéma public), sans migration ni seed.
- `npm run deploy:bootstrap` : catalogue fictif dans une base Neon dédiée, depuis le poste opérateur uniquement, sans réinitialiser les produits ou clés existants.
- `npm run deploy:verify` : contrôle des migrations, de l'horloge UTC du pool et du chiffrement, puis aller-retour d'une petite image technique dans Blob avec suppression. Ne capture aucun paiement et n'envoie aucun email.

## 1. Créer les services

Dans Neon, créer un projet et une branche dédiée à la maquette, si possible dans une région européenne proche de Paris. Copier les deux connexions depuis **Connect** : connexion avec pooling pour `DATABASE_URL`, sans pooling pour `DIRECT_URL`. Les deux doivent désigner la même branche, base et le même rôle. La configuration Prisma utilise la connexion directe pour les migrations. Voir [les usages recommandés par Neon](https://neon.com/docs/connect/connection-pooling).

Dans Vercel, importer le dépôt GitHub du projet. Choisir Node.js 24.x. Créer/connecter un store **Vercel Blob privé**, puis définir `PRODUCT_IMAGE_STORAGE=vercel-blob` et son `BLOB_READ_WRITE_TOKEN`. Les images restent accessibles au catalogue par les URLs applicatives `/api/media/products/:uuid.webp` ; le navigateur ne reçoit ni le token ni une URL privée Blob. Les photos sont décodées, optimisées et stockées comme auparavant. Les nouveaux fichiers entrants sont limités à **4 Mo**, pour rester sous la limite du corps des fonctions Vercel ([limites Vercel](https://vercel.com/docs/functions/limitations)).

Le disque local `.local/product-images/` reste utilisé sur le Mac. Il est refusé si l'application tourne sur Vercel. Une image absente renvoie 404 ; une indisponibilité du stockage renvoie 503 sans mise en cache de l'erreur.

## 2. Préparer les variables privées

Copier `.env.vercel.example` dans un fichier privé `.env.hosted`, puis renseigner les valeurs. Ce fichier est ignoré par Git et Vercel. Ne pas remplacer le `.env` local : il reste relié à la base du Mac.

Pour charger ce fichier dans les commandes opérateur, utiliser Node 24 :

```bash
node --env-file=.env.hosted --experimental-strip-types scripts/check-deployment.ts
```

Les valeurs du fichier sont chargées avant les valeurs locales de Next.js ; toutes les variables sensibles nécessaires doivent y être renseignées explicitement. Ne jamais placer les secrets dans les arguments de commande, dans GitHub ou sous un nom `NEXT_PUBLIC_`.

Pour une **base distante neuve**, générer des secrets distincts : authentification, chiffrement, empreintes et cron. Pour une **copie de la base locale existante**, conserver impérativement les secrets de chiffrement/empreinte et leur identifiant d'origine, y compris pour relire les comptes PayPal archivés et les emails chiffrés. Un changement de secret n'est pas une migration des données.

Définir `NEXTAUTH_URL` sur l'adresse HTTPS stable du projet (par exemple l'alias `https://nom-du-projet.vercel.app`). Les retours PayPal, liens email et contrôles d'origine utilisent cette adresse. Un domaine personnel n'est pas nécessaire pour les essais Sandbox. Séparer les branches Neon, stores Blob et secrets des environnements Preview et Production ; une prévisualisation ne doit jamais réutiliser la base active.

## 3. Préparer la base

La préparation est explicite, depuis le poste opérateur, et ne fait pas partie du build Vercel :

```bash
node --env-file=.env.hosted --experimental-strip-types scripts/prepare-hosted-database.ts
node --env-file=.env.hosted node_modules/prisma/build/index.js migrate deploy
```

La préparation fixe UTC et le schéma public au niveau du rôle dans cette base. Les connexions Neon transactionnelles ne dépendent pas de paramètres de session `SET`/`options`. Après ce changement, fermer les anciens pools et redémarrer le compute Neon si nécessaire afin de renouveler ses connexions. Le script `deploy:verify` exige UTC sur la connexion poolée, sans masquer une mauvaise configuration par une option de session.

**Base neuve :** initialiser les données fictives avec la commande suivante depuis le Mac, puis remettre `DEMO_SEED_ENABLED=false` dans toutes les variables d'exécution hébergées :

```bash
NODE_ENV=development DEMO_SEED_ENABLED=true node --env-file=.env.hosted --experimental-strip-types scripts/bootstrap-hosted-demo.ts
node --env-file=.env.hosted --experimental-strip-types scripts/provision-admin.ts
```

Ne pas définir `VERCEL` ni `VERCEL_ENV=production` dans le fichier opérateur destiné au bootstrap. Le seed reste interdit dans les processus de production. La commande administrateur demande ses informations en saisie masquée, ne remplace aucun compte réel existant et ne crée aucun mot de passe par défaut.

**Copie des données locales :** sauvegarder la base PostgreSQL par connexion directe avec `pg_dump`, le dossier des images et les secrets séparément. Restaurer le dump dans une branche Neon vide avec une version compatible de `pg_restore`, puis appliquer les migrations et préparer le rôle. Ce transfert ne se produit pas automatiquement. Les utilisateurs, commandes, stocks, réservations et versions PayPal doivent être conservés ensemble ; ne pas remettre les stocks à zéro. Importer aussi les fichiers WebP dans Blob sous les mêmes noms `product-images/:uuid.webp` avant de basculer le site sur ces données. Les captures et retours d'anciennes tentatives restent liés à leur origine locale : les finaliser ou les rapprocher avant la bascule.

## 4. Planifier les tâches de fond

Deux routes GET sont disponibles :

- `/api/internal/jobs/paypal` : traite au plus deux tentatives par appel (expiration, approbation et rapprochement).
- `/api/internal/jobs/emails` : traite au plus trois messages par appel.

Elles refusent les appels si `BACKGROUND_JOBS_ENABLED` n'est pas `true`, si le secret est absent ou trop court, ou si l'en-tête `Authorization: Bearer <CRON_SECRET>` est incorrect. Les réponses ne contiennent que des compteurs. Les verrous des paiements et de la file email restent appliqués ; un arrêt de fonction conserve les travaux récupérables.

Avec `vercel.json`, configurer un planificateur externe pour appeler **les deux routes chaque minute**, avec cet en-tête, puis définir `SCHEDULER_MODE=external`. Garder le secret dans le gestionnaire de secrets du planificateur, pas dans l'URL. Si la protection de déploiement Vercel est active, lui donner aussi le mécanisme de contournement réservé à l'automatisation ; l'authentification interne reste obligatoire.

Avec une offre Vercel autorisant la fréquence minute, remplacer la configuration par `deployment/vercel.pro.json` et définir `SCHEDULER_MODE=vercel-pro`. Vercel transmet `CRON_SECRET` dans l'en-tête prévu. Le fichier par défaut n'impose pas de souscription. L'offre Hobby limite actuellement les crons Vercel à une exécution quotidienne, insuffisante pour les réservations de 30 minutes et les reprises rapides ([documentation Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing)).

Les limites sont adaptées à une maquette à faible trafic. Contrôler les files et les durées de traitement avant toute augmentation du volume. L'envoi immédiat via `after()` complète le planificateur ; il ne remplace pas les reprises périodiques.

## 5. Configurer PayPal Sandbox hébergé

Conserver `PAYPAL_CHECKOUT_ENABLED=false` jusqu'à la configuration du compte marchand et des notifications :

```bash
node --env-file=.env.hosted --experimental-strip-types scripts/configure-paypal.ts --hosted-sandbox --label="Maquette hébergée"
```

Ce mode doit être demandé explicitement. Il accepte uniquement une cible Neon dédiée et une origine HTTPS en mode démonstration. Il versionne les identifiants marchands chiffrés en base et affiche uniquement l'identifiant interne du compte et le chemin webhook. Il ne modifie pas le `.env` du Mac et ne capture aucun paiement.

Enregistrer ensuite l'URL HTTPS `/api/paypal/webhooks/:merchantId` dans l'application PayPal Sandbox du même compte. Souscrire aux événements utilisés : `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`. Renseigner `PAYPAL_WEBHOOK_ID`, puis relancer la même commande pour mémoriser cet identifiant sur la version concernée. Vérifier la réception d'un événement réellement signé avant d'activer les paiements sur l'instance hébergée. Un simulateur de signature n'est pas une approbation acheteur. Voir [la procédure officielle PayPal](https://developer.paypal.com/api/rest/webhooks/rest/).

Activer ensuite `PAYPAL_CHECKOUT_ENABLED=true` dans Vercel et redéployer. `DEMO_CHECKOUT_ENABLED` concerne le bouton de simulation sans PayPal ; le laisser à `false` si seul le parcours Sandbox doit être disponible. `APP_MODE` reste `demo` et `PAYPAL_ENV` reste `sandbox`.

## 6. Relier Vercel et vérifier

Copier les variables de `.env.hosted` dans les paramètres du projet Vercel pour l'environnement choisi, avec `DEMO_SEED_ENABLED=false`. Lancer le déploiement. La commande `build:vercel` refuse une configuration hébergée incomplète avant de compiler. Elle n'applique aucune migration et ne crée aucun compte.

Depuis le Mac avec les mêmes valeurs :

```bash
node --env-file=.env.hosted --experimental-strip-types scripts/verify-hosted-deployment.ts
```

Ce contrôle ne prouve pas que le webhook est reçu ou que le planificateur tourne : consulter leurs journaux et effectuer ces essais après déploiement. Vérifier ensuite inscription/connexion, upload d'une photo, commande avec un acheteur Sandbox, retour vers les mêmes clés, téléchargement privé et réception email pour l'adresse Resend autorisée. Fermer le navigateur lors d'un autre essai pour vérifier que le rapprochement périodique termine le paiement. Ne jamais créer un compte ou envoyer des clés à une autre personne sans son accord.

Pour les emails sans domaine, conserver le mode `resend-test`, l'expéditeur existant et le destinataire autorisé. Le déploiement n'ouvre pas l'envoi à tous les clients.

## Sauvegarde et retour arrière

Sauvegarder avant chaque migration : dump PostgreSQL par connexion directe, images Blob et secrets de chiffrement séparément. Tester une restauration dans une branche isolée. Vérifier la rétention des sauvegardes selon l'offre Neon choisie ; ne pas considérer une branche comme une sauvegarde des images ou des secrets.

En cas de problème, désactiver les nouvelles tentatives PayPal et simulations puis redéployer. Garder le suivi des tentatives existantes et les anciennes versions marchandes. Revenir à un déploiement Vercel précédent ne restaure pas la base ni les images et ne justifie pas d'annuler des attributions. Aucun script de retour arrière destructeur n'est fourni.

## Validation locale de la préparation

Tests unitaires et configuration : 35 réussis. Tests PostgreSQL : 66 réussis. Tests navigateur : 45 réussis. Total : **146 tests** ; TypeScript et build de production réussis. Les nouveaux tests couvrent l'authentification des tâches, les configurations hébergées invalides, la persistance locale et le stockage Blob privé avec fournisseur simulé. Aucun service Neon/Blob distant n'a été validé dans ce bilan.
