# UNLOCK-ALL

Phases 2 à 11 — interface FR/EN, PostgreSQL/Prisma, authentification, catalogue, stocks, panier et commandes simulées en base. Emails Resend de test FR/EN et paiement PayPal Sandbox. Vérification globale et paiement acheteur Sandbox validés ; préparation Vercel/Neon disponible. Aucun argent réel débité.

## Lancer le projet

Prérequis : Node.js 24+ et npm. Les dépendances exactes sont verrouillées dans `package-lock.json`.

```bash
npm ci
npm run db:local:start
npm run db:migrate
npm run db:seed
npm run auth:configure
npm run demo:configure
npm run dev
```

Ouvrir http://127.0.0.1:3000/fr. La racine redirige vers le français ; l’anglais est accessible via le sélecteur FR/EN ou `/en`.

```bash
npm run typecheck
npm test
npm run build
npm run start
```

Le build et le développement utilisent Webpack : le processus de compilation CSS de Turbopack ne peut pas ouvrir son port de travail dans cet environnement. Cela ne modifie pas le framework ni les fonctionnalités de l’application.

## Base de données — phase 3

Le catalogue public et les comptes nécessitent PostgreSQL. Pour préparer la base locale, installer aussi PostgreSQL 14+ et exécuter :

```bash
npm run db:local:start
npm run db:migrate
npm run db:seed
npm run db:check
```

Le script local crée une instance dédiée sur `127.0.0.1:55432`, un fichier `.env` privé si absent et des secrets de chiffrement aléatoires. Il ne modifie pas le serveur PostgreSQL existant. `PG_BIN` permet de choisir un dossier de binaires PostgreSQL ; `UNLOCK_ALL_PG_PORT` permet de choisir un autre port à la première création.

Sept migrations définissent les tables, les relations, les contraintes SQL et les protections d’authentification. Le seed charge 12 produits bilingues, 2 profils fictifs et 146 clés chiffrées. Le profil administrateur de base est inactif, sans mot de passe. Relancer le seed préserve les modifications et les clés déjà attribuées ou désactivées.

```bash
npm run db:status
npm run test:db
npm run db:local:stop
```

Les tests SQL utilisent un schéma temporaire isolé et le suppriment ensuite. La base locale se trouve dans le dossier temporaire du système ; sauvegarder ses données et les secrets avant tout nettoyage de ce dossier.

La configuration Neon est prête via `DATABASE_URL` et `DIRECT_URL`, mais aucun projet Neon distant n’a été créé ou connecté. Voir [la procédure et le modèle de données](docs/phase-3.md).

Pour parcourir visuellement les tables et leurs données dans Prisma Studio :

```bash
npm run db:studio
```

Ouvrir http://localhost:5555. Les tables principales sont `User`, `Product`, `ProductTranslation`, `ActivationKey`, `Order`, `OrderItem` et `KeyAssignment`. Les clés d’activation sont chiffrées ; les commandes apparaissent dès la première simulation réussie ou échouée. Studio permet aussi de modifier les données de la base.

## Explorer la démonstration

- **Client** : créer un compte via `/fr/inscription`, puis utiliser son email et son mot de passe. Les anciens boutons de connexion fictive ont été retirés.
- **Commande** : utiliser un Discord fictif tel que `player.demo`, confirmer les conditions, puis simuler la commande. Les clés et le téléchargement restent consultables dans « Mes commandes ».
- **Administrateur** : exécuter `npm run auth:admin`, renseigner une nouvelle adresse, un pseudonyme et un mot de passe en saisie masquée, puis se connecter et consulter `/fr/admin`. Aucun identifiant administrateur par défaut n’est fourni.
- **Stock épuisé** : le produit « Toutes les armes · Xbox » est volontairement sans stock initial.
- **Remise à zéro** : bouton « Réinitialiser la démo » dans l’administration ou la page Confidentialité.

L’accueil affiche jusqu’à cinq lignes de produits publiés (20 sur ordinateur, 10 sur mobile), puis le bouton « Ouvrir le catalogue » mène à la boutique complète.

Le catalogue initial comporte douze produits : quatre collections, chacune déclinée en PC, PlayStation et Xbox. Les illustrations SVG sont originales et locales. Le seul fichier livré est un document texte inoffensif.

## Authentification — phase 4

Les comptes et profils sont maintenant enregistrés dans PostgreSQL. Auth.js utilise des JWT chiffrés en cookies HttpOnly, associés à des sessions révocables en base. Argon2id protège les mots de passe ; la politique est de 15 à 128 caractères. Les rôles et l’état actif du compte sont relus côté serveur.

Le profil permet de modifier le pseudonyme et Discord. L’adresse de connexion reste en lecture seule dans cette version. Le profil authentifié n’est pas enregistré dans le stockage local du navigateur.

En développement, « Mot de passe oublié » dépose un lien privé dans `.local/password-reset/` lorsque `AUTH_RESET_DELIVERY=local` et `APP_MODE=demo`. Sur macOS, ouvrir ce dossier avec `open .local/password-reset`, puis copier l’URL du fichier JSON dans le navigateur. Le lien expire après 20 minutes et ne peut servir qu’une fois. Aucun email n’est envoyé par ce mode local. Il est désactivé en production et sur Vercel. La phase 8 ajoute le mode Resend de test.

`npm run auth:cleanup` supprime les sessions, jetons et limites expirés, ainsi que les messages locaux expirés. Voir [la documentation de la phase 4](docs/phase-4.md).

## Catalogue et administration — phase 5

Les produits publiés sont lus depuis PostgreSQL. La création, les traductions FR/EN, les prix, les plateformes, les illustrations et la désactivation s’enregistrent depuis `/fr/admin/produits`. Les modifications sont journalisées et les versions anciennes refusées. Un brouillon n’est jamais envoyé dans le catalogue public.

Le dashboard calcule ses indicateurs en base. `/fr/admin/utilisateurs` permet de rechercher les comptes réels, gérer leurs rôles et leur activation ; les changements révoquent les sessions existantes et la protection du dernier administrateur reste appliquée par PostgreSQL. Les stocks et commandes sont connectés aux phases 6 et 7. Voir [la documentation de la phase 5](docs/phase-5.md).

## Stocks et panier — phase 6

Le stock affiché est calculé à partir des clés non attribuées et non désactivées. `/fr/admin/stocks` permet d’ajouter, afficher et désactiver les clés de démonstration. Les valeurs sont chiffrées et masquées par défaut, et les opérations sont auditées.

Le panier invité est en base avec un cookie HttpOnly de 30 jours. À la connexion, il fusionne une seule fois avec le panier du compte, dans la limite des stocks. Les quantités et les totaux sont vérifiés côté serveur ; les conflits entre onglets n’écrasent pas les modifications distantes. Ajouter au panier ne réserve pas de clé. Les anciens paniers locaux ne sont plus utilisés.

La phase 7 attribue les clés à la validation et vide le panier uniquement si la commande aboutit. Voir [la documentation de la phase 6](docs/phase-6.md).

## Commandes simulées — phase 7

La validation crée une commande PostgreSQL avec un instantané des produits et des prix. Une transaction verrouille les stocks, attribue une clé fictive distincte par unité et vide le panier après réussite. Une rupture conserve le panier et une commande échouée sans clé attribuée. Une clé illisible demande une intervention interne.

Une tentative possède un identifiant unique : les doubles validations et les reprises après une réponse perdue retrouvent la même commande. Le compte client retrouve son historique, ses clés et ses téléchargements ; un administrateur peut consulter les commandes depuis son espace. Le suivi distingue emails en attente, acceptés par Resend et en erreur.

Les trois conditions `APP_MODE=demo`, `DEMO_CHECKOUT_ENABLED=true` et `SiteSetting.demoEnabled=true` sont requises. `npm run demo:configure` les active sur la configuration locale déjà en mode démo ; `npm run demo:configure -- --disable` désactive les simulations. Redémarrer le serveur si nécessaire. Les valeurs par défaut restent désactivées pour toute nouvelle installation. Voir [la documentation de la phase 7](docs/phase-7.md).

## Emails — phase 8

Les modèles de bienvenue, confirmation, livraison des clés et réinitialisation existent en FR/EN avec une version texte. L’envoi passe par une file PostgreSQL, avec un corps chiffré, une clé d’idempotence stable et des reprises sans réattribuer les clés. Le suivi est visible dans le détail de commande et un administrateur peut relancer les erreurs encore éligibles.

Placer `RESEND_API_KEY` dans le fichier `.env` privé, puis configurer l’adresse exacte du compte Resend :

```bash
npm run email:configure -- --recipient=votre-adresse-resend@example.com
npm run dev
npm run email:worker -- --watch
```

Le worker doit rester ouvert pour les reprises automatiques sans navigation. Seule l’adresse autorisée reçoit les emails ; aucun message d’un autre compte n’est redirigé vers elle. `npm run email:preview` génère huit aperçus locaux ; `npm run email:test` envoie un test technique unique. L’acceptation par Resend ne garantit pas l’arrivée dans la boîte mail. Voir [la documentation de la phase 8](docs/phase-8.md).

## PayPal Sandbox — phase 9

Le parcours initial réservait les clés puis redirigeait vers PayPal Checkout. Son suivi reste disponible pour les anciennes tentatives. Le nouveau panier utilise un **envoi PayPal Sandbox par référence** : destinataire Business vérifié, montant exact et note unique ; les clés sont livrées après rapprochement serveur via Transaction Search. Voir [la configuration et les limites du nouveau parcours](docs/phase-12.md).

```bash
npm run paypal:check
npm run paypal:configure -- --label="Sandbox A"
npm run dev
npm run paypal:reconcile -- --watch
```

Configurer préalablement `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID` et `PAYPAL_CLIENT_SECRET` dans `.env`. Le processus de rapprochement doit rester ouvert pour les reprises et expirations locales. Chaque tentative conserve le compte Business utilisé ; une bascule de compte ne réécrit pas l’historique. Le mode Live est refusé. Le webhook est prêt mais nécessite une URL publique HTTPS pour être enregistré ; le rapprochement local permet les essais sans cette URL. Voir [la documentation de la phase 9](docs/phase-9.md).

## Limites explicites

Le catalogue, les comptes et les indicateurs administrateur sont enregistrés dans PostgreSQL. Les stocks et paniers sont désormais partagés via PostgreSQL. Les commandes et leurs clés ne sont plus enregistrées dans le stockage local. `localStorage` conserve une copie publique du catalogue sous la clé `unlock-all:demo:v1`, sans le profil authentifié, son email ou son Discord. Le catalogue local ne remplace jamais les prix et publications lus au serveur. Si le stockage est indisponible ou invalide, la visite fonctionne en mémoire avec un avertissement.

- Aucun débit réel, appel Discord ou service de jeu. PayPal utilise uniquement Sandbox. Les emails réels de la maquette sont limités au destinataire autorisé du compte Resend.
- Inscription, connexion, déconnexion et modification du profil sont réelles. Aucun mot de passe en clair n’est conservé.
- L’administration nécessite maintenant un véritable rôle ADMIN vérifié côté serveur. Les produits, les utilisateurs et les indicateurs sont reliés à PostgreSQL. Les deux profils initiaux fictifs restent en lecture seule.
- Les clés en base sont chiffrées et masquées. Un administrateur peut en demander une consultation auditée ; un client ne reçoit que celles de ses commandes terminées. Les anciennes fixtures et les codes de prévisualisation sont entièrement fictifs.
- Le panier connecté et le stock sont partagés entre navigateurs. Le panier invité repose sur un cookie HttpOnly. Les commandes sont accessibles sur les différents navigateurs du compte. Les anciens aperçus locaux ne sont pas importés.
- L’idempotence et l’attribution atomique sont appliquées dans PostgreSQL, avec des tests de concurrence et de retour arrière transactionnel.
- Les produits acceptent une image PNG, JPG ou WebP (4 Mo maximum), ou une des quatre illustrations livrées. Dans Produits → Modifier → Ajouter une image, choisir le fichier puis Enregistrer. Les fichiers optimisés restent dans `.local/product-images/` en local ; sur Vercel, un store Blob privé conserve les images via les mêmes URLs applicatives. Sauvegarder les images avec la base.
- Le chemin virtuel `/downloads/demo/unlock-all-demo.txt` désigne le fichier privé `assets/downloads/unlock-all-demo.txt`. Il est servi par une route authentifiée après vérification de la commande et ne se trouve plus dans `public/`. Aucun autre fichier n’est livré dans cette phase.
- Les prix sont fictifs, stockés en centimes entiers. Les commandes conservent un instantané des noms, plateformes, prix et téléchargements.

Prisma, PostgreSQL et Auth.js sont configurés. Les comptes, le catalogue, les stocks et les paniers utilisent la base ; les commandes sont enregistrées en base. Resend est intégré par son API HTTP, sans dépendance supplémentaire. Le mode de commande serveur est désactivé par défaut et s’active explicitement pour la démonstration. Cette démonstration ne doit pas être utilisée comme boutique commerciale.

## Organisation

- `src/app/[locale]` : routes Next.js explicites, layouts, chargement, erreurs et métadonnées traduites.
- `src/features` : interfaces catalogue, panier, commande, compte, support et administration.
- `src/components` : structure partagée et bouton composé selon le modèle shadcn/ui.
- `src/demo` : données fictives, types, moteur de commande, validation du stockage et contexte local.
- `prisma` : schéma relationnel, migrations versionnées et seed idempotent.
- `src/server/db` : client Prisma PostgreSQL, chargé uniquement côté serveur ou par les scripts.
- `src/server/security` : chiffrement authentifié des clés et empreinte d’unicité.
- `scripts` : gestion de l’instance PostgreSQL locale et contrôle de la connexion.
- `src/i18n` : messages FR/EN, configuration next-intl et formats monétaires/date.
- `src/styles/globals.css` : tokens sémantiques, styles et adaptations responsive.
- `public/images` : illustrations SVG originales ; aucun chargement d’images distant.
- `tests` : règles, contraintes PostgreSQL, services et parcours navigateur.

Les chemins fonctionnels sont actuellement identiques sous `/fr` et `/en`, avec contenu et métadonnées traduits. Les dates sont affichées selon la langue ; next-intl utilise le fuseau Europe/Paris.

## Tests navigateur

Les tests Playwright utilisent Google Chrome installé sur la machine. Pour un autre exécutable Chromium, définir `PLAYWRIGHT_CHROMIUM_EXECUTABLE` avec son chemin.

```bash
npm run test:e2e
```

Exécuter `npm run build` au préalable. La suite crée un schéma PostgreSQL isolé, démarre son propre serveur de production sur le port 3100 et supprime le schéma après exécution. Les comptes créés par les tests ne restent pas dans votre base applicative. Le serveur de développement sur le port 3000 n’est pas réutilisé.

Les tests couvrent les tailles 320, 768, 1024 et 1440 px, les filtres, le stock épuisé, le panier multi-produit, la fusion après connexion, les clés distinctes, l’historique, les profils, l’administration, le changement de langue et les données locales invalides. Les captures de contrôle sont enregistrées dans le dossier temporaire de la machine ; les échecs et traces sont dans `test-results/`.

## Suite du projet

La maquette est hébergée sur Vercel et Neon, avec les images dans Blob privé. Le parcours PayPal Checkout initial a été essayé en Sandbox. La phase 12 le remplace pour les nouvelles tentatives par [un paiement par référence](docs/phase-12.md), soumis à l’autorisation effective de Transaction Search et à un nouvel essai acheteur Sandbox. Voir aussi [les variables de déploiement](docs/phase-11.md) et `.env.vercel.example`. Aucun paiement réel n’est activé.
