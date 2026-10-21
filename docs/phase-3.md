# Phase 3 — PostgreSQL et Prisma

Le socle de stockage est opérationnel et testé avec PostgreSQL local. Le frontend validé reste sur son adaptateur de démonstration dans le navigateur. Aucun formulaire, paiement, email ni commande serveur n’a été connecté à cette étape.

## Versions

- Prisma CLI, Prisma Client et adaptateur PostgreSQL : **7.10.1**, versions alignées et verrouillées.
- Pilote `pg` : **8.23.1**.
- Node.js : **24+** ; TypeScript et Next.js déjà validés dans le projet.
- PostgreSQL : **14+** pour le schéma utilisé ; validation locale avec les binaires installés sur la machine.

La balise npm `latest` du CLI pointait vers une préversion lors de la vérification. Le projet utilise explicitement la version stable 7.10.1. Le client est généré avec `prisma-client` dans `src/generated/prisma/`, non versionné, avec imports TypeScript compatibles avec l’exécution native de Node.js. `npm ci` le régénère via `postinstall` ; cette opération ne nécessite pas de connexion à une base.

## Démarrage local

Prérequis : PostgreSQL installé, notamment `initdb`, `pg_ctl`, `psql` et `createdb`. Sur cette machine, les binaires sont disponibles via Homebrew. Définir `PG_BIN` si nécessaire pour choisir une version précise.

```bash
npm ci
npm run db:local:start
npm run db:migrate
npm run db:seed
npm run db:check
```

`db:local:start` gère exclusivement une instance propre au projet sur `127.0.0.1:55432`. Les services existants sur les autres ports restent indépendants. Un autre port peut être choisi avec `UNLOCK_ALL_PG_PORT` lors de la première création.

La configuration de cette instance est conservée dans `.local/postgres.json`, ignoré par Git. Les fichiers PostgreSQL se trouvent dans un sous-dossier privé du dossier temporaire système. L’instance utilise l’authentification locale `trust` pour des données exclusivement fictives, avec écoute réseau limitée à la boucle locale.

Le script génère `.env` avec des permissions privées et deux secrets indépendants si ce fichier n’existe pas. Il préserve tout `.env` existant. Dans ce dernier cas, vérifier sa destination avant de lancer les migrations : le script ne remplace pas une configuration Neon par une configuration locale.

```bash
npm run db:local:stop
npm run db:local:start
```

L’arrêt conserve les données. Un nettoyage du dossier temporaire système peut supprimer le cluster : sauvegarder la base et ses secrets avant ce nettoyage. Si le cluster a disparu, le script refuse de masquer cette perte ; conserver le `.env` et déplacer les métadonnées `.local/postgres.json` pour créer une nouvelle instance de démonstration, ou restaurer une sauvegarde. Aucun script de remise à zéro destructive n’est fourni.

Résultat initial attendu de `db:check` : 12 produits, 2 profils fictifs, 146 clés disponibles, 0 attribution et mode de commande serveur désactivé. La déclinaison Xbox du pack « Toutes les armes » est volontairement sans clé.

## Connexion à Neon

Aucun compte ni projet Neon n’a été créé pendant cette phase. La préparation suivante est prête pour une branche de développement dédiée :

1. Créer ou sélectionner le projet et une branche de développement dans Neon.
2. Renseigner sa connexion **poolée** dans `DATABASE_URL` et sa connexion **directe** dans `DIRECT_URL`, en conservant les paramètres TLS fournis par Neon.
3. Définir deux secrets indépendants de 32 octets aléatoires, chacun encodé en 64 caractères hexadécimaux, ainsi que `ACTIVATION_KEY_KEY_ID`.
4. Pour charger les données fictives uniquement, activer `APP_MODE=demo` et `DEMO_SEED_ENABLED=true`, hors environnement de production.
5. Exécuter `npm run db:migrate`, puis `npm run db:seed` et `npm run db:check`.

Les variables restent privées, sans préfixe `NEXT_PUBLIC_`. `.env.example` décrit les valeurs requises et ne contient aucun secret réel. Ne pas afficher les URLs de connexion dans les logs ou les partager dans des captures d’écran.

`prisma.config.ts` utilise `DIRECT_URL` pour les migrations et le seed. Le client applicatif `getDatabase()` utilise `DATABASE_URL`, un pool limité à cinq connexions et une instance réutilisée par processus. Cette limite pourra être ajustée avec la configuration Vercel/Neon en phase 10. Le client est créé à la demande : le frontend et le build n’exigent aucune base disponible.

Le paramètre de schéma PostgreSQL est pris en charge par la fabrique du client pour que le pilote, Prisma et les triggers utilisent le même schéma. Les tests utilisent cette possibilité sans modifier les tables applicatives.

## Modèle relationnel

Le schéma comporte 23 tables :

| Domaine                   | Tables                                                                     | Responsabilité                                                                                   |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Identité                  | `User`                                                                     | Email normalisé unique, rôle, activation, Discord, langue, hash facultatif et version de session |
| Authentification réservée | `Account`, `Session`, `VerificationToken`, `PasswordResetToken`            | Modèles compatibles avec l’adaptateur Auth.js et jetons temporaires                              |
| Référentiels              | `Category`, `CategoryTranslation`, `Game`, `Platform`                      | Classement, plateformes et libellés bilingues                                                    |
| Catalogue                 | `Product`, `ProductTranslation`, `ProductImage`, `ProductImageTranslation` | Publication, prix, descriptions et visuels FR/EN                                                 |
| Inventaire                | `ActivationKey`                                                            | Valeur chiffrée, empreinte d’unicité, version du secret et désactivation                         |
| Panier                    | `Cart`, `CartItem`                                                         | Panier d’un compte, produit unique par panier et quantités positives                             |
| Commandes                 | `Order`, `OrderItem`                                                       | Identité, idempotence, états et instantanés historiques                                          |
| Livraison                 | `KeyAssignment`, `OrderEvent`                                              | Une clé par unité, relations de produit cohérentes et événements ajoutés sans réécriture         |
| Emails                    | `EmailJob`                                                                 | File transactionnelle de notifications, tentatives et reprises futures                           |
| Traçabilité               | `AuditLog`                                                                 | Actions administratives, sans secret dans les détails                                            |
| Configuration             | `SiteSetting`                                                              | Ligne unique, lien Discord facultatif, mode serveur de démonstration désactivé par défaut        |

`Account` et `Session` sont réservés à la phase 4 : ils ne simulent pas une authentification effective. Avec Credentials et des sessions JWT, ces tables pourront rester inutilisées. Le seed ne crée aucune session, aucun compte de fournisseur ni jeton de réinitialisation.

Les deux profils de démonstration n’ont aucun hash de mot de passe. Le profil administrateur est en plus **inactif**. Il ne constitue donc pas un accès administrateur prêt à se connecter ; le provisionnement sécurisé sera traité avec l’authentification.

Les slugs traduits sont uniques par langue. Le slug canonique du produit permet de conserver les routes du prototype. Tous les horodatages utilisent `timestamptz`.

## Montants et historique

Les prix unitaires sont des entiers en centimes. Les totaux de lignes et de commandes utilisent `BigInt` pour éviter les dépassements lors des multiplications. Aucun calcul monétaire ne dépend de nombres flottants.

Les futures réponses API devront sérialiser les `BigInt` explicitement, en chaînes décimales ou en nombres après vérification de leur borne sûre ; `JSON.stringify` ne les accepte pas directement.

Chaque ligne conserve les noms FR/EN, le jeu, la plateforme, le prix unitaire et le téléchargement au moment de la commande. Les modifications du produit ne changent pas ces instantanés. Une ligne validée devient immuable.

La V1 impose, pour une commande terminée, que le total corresponde à la somme des lignes et au sous-total. Promotions, taxes, remboursements ou nouveaux ajustements nécessiteront une évolution explicite du modèle.

## Garanties d’intégrité

Les contraintes classiques sont dans le schéma Prisma. Les vérifications et triggers PostgreSQL supplémentaires sont versionnés dans la deuxième migration ; la troisième lie les emails de commande à leur propriétaire.

- **Disponibilité** : une clé est disponible si elle n’est ni désactivée ni attribuée. Aucun compteur manuel ne remplace cette règle.
- **Unicité** : `KeyAssignment.keyId` est une clé primaire ; une même clé ne peut avoir deux attributions.
- **Cohérence produit** : deux clés étrangères composites garantissent que la clé et la ligne de commande concernent le même produit.
- **Quantités** : chaque attribution possède un indice d’unité, unique dans sa ligne, compris entre 1 et la quantité commandée.
- **Concurrence** : un trigger verrouille la clé pendant l’attribution. La contrainte d’unicité arbitre les tentatives simultanées.
- **Conservation** : une attribution ne peut être modifiée ou supprimée. Une clé livrée ne peut être remplacée, déplacée ou désactivée.
- **Finalisation** : une contrainte différée vérifie à la fin de la transaction que chaque exemplaire d’une commande terminée possède sa clé et que les totaux concordent.
- **Idempotence** : unicité du couple utilisateur/clé d’idempotence, identité de commande immuable et empreinte de requête conservée.
- **Modes** : les clés fictives ne peuvent être attribuées à une commande commerciale. Une commande commerciale ne peut être terminée avec un paiement non vérifié ; aucune intégration de paiement n’existe pour autant.
- **Emails** : l’unicité de la tâche prépare la déduplication, et sa relation composite empêche de rattacher une livraison à un autre utilisateur. L’échec d’une tâche ne modifie pas la commande ni ses clés.

Les tests SQL vérifient ces contraintes directement, y compris deux transactions qui réclament simultanément la même clé. Cela ne signifie pas qu’un checkout serveur est déjà livré : la phase 7 devra encore gérer les autorisations, le recalcul des prix, la comparaison des empreintes d’idempotence, le verrouillage ordonné de toutes les clés, les reprises de conflits et l’atomicité de l’ensemble de la commande.

La machine d’états complète, la protection serveur du dernier administrateur, les limites de requêtes et les procédures d’envoi/reprise des emails seront développées dans leurs modules respectifs. Les contraintes de stockage ne remplacent pas ces services.

## Protection des clés

`src/server/security/key-vault.ts` fournit un chiffrement AES-256-GCM, avec nonce aléatoire de 12 octets, authentification du contenu et de la version du secret. Une empreinte HMAC-SHA-256 avec un secret séparé assure l’unicité sans stocker la valeur en clair.

Les secrets ne sont ni en base ni dans les logs. Les données chiffrées ne sont jamais importées dans les composants du navigateur. Les futures fonctions de déchiffrement devront être appelées après vérification des droits sur la commande ; aucun endpoint de déchiffrement public n’est fourni.

Sauvegarder les secrets séparément de la base. Les changer sans migration de chiffrement rendrait les clés existantes illisibles ; changer le secret d’empreinte casserait la détection des doublons. Le seed vérifie les clés existantes et refuse une configuration incompatible. La rotation de secrets n’est pas implémentée à cette phase.

## Seed de démonstration

Le seed est explicite : `npm run db:seed`. Il est refusé sans `APP_MODE=demo` et `DEMO_SEED_ENABLED=true`, ou si `NODE_ENV` ou `VERCEL_ENV` vaut `production`.

Il utilise une transaction et un verrou consultatif afin de sérialiser les exécutions concurrentes. Les identifiants de données initiales sont déterministes. Les enregistrements existants ne sont ni supprimés ni remis à zéro : prix modifiés, comptes existants, clés livrées, clés désactivées et réglage du mode démo sont conservés. Aucune commande ni confirmation d’email fictive n’est créée.

Le mode de checkout serveur reste désactivé à la fois dans l’exemple de configuration et dans la ligne initiale `SiteSetting`. L’interface de présentation locale, indépendante, demeure disponible.

## Migrations et contrôles

```bash
npm run db:validate
npm run db:generate
npm run db:migrate
npm run db:status
npm run db:check
npm test
npm run test:db
npm run typecheck
npm run build
```

`db:migrate` applique uniquement les migrations versionnées, sans remise à zéro. En développement, `npm run db:migrate:dev -- --name nom_du_changement` prépare la migration suivante. Sur Neon, une base shadow distincte peut être renseignée via `SHADOW_DATABASE_URL` ; ne jamais désigner la base applicative comme base shadow.

Ne pas remplacer les migrations par `prisma db push` : les triggers SQL font partie des garanties du projet et ne sont pas générés depuis le schéma Prisma. Les migrations déjà appliquées ne doivent pas être réécrites.

Les tests SQL créent leur propre schéma `unlock_all_test_*`, y appliquent toutes les migrations et le suppriment après le test. Ils utilisent `TEST_DATABASE_URL` si défini, sinon `DIRECT_URL`. Utiliser une base de développement autorisant la création de schémas. Les tests sont refusés en environnement de production et ne touchent pas aux tables applicatives existantes.

## Suite

Phase 4 après validation : inscription, connexion, sessions et rôles sécurisés. Le catalogue et l’administration seront ensuite connectés à la base en phase 5, puis les stocks et commandes dans les phases 6 et 7. Aucun déploiement Vercel ou Neon n’a été réalisé.

## Références techniques

- [Configuration des générateurs Prisma](https://www.prisma.io/docs/orm/prisma-schema/overview/generators)
- [Seed Prisma](https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding)
- [Gestion des connexions Prisma](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-management)
- [Connexion de Prisma à Neon](https://neon.com/docs/guides/prisma)

## Vérifications effectuées le 20 octobre 2026

- Trois migrations appliquées à l’instance locale dédiée ; statut Prisma à jour.
- Comparaison de la base au schéma Prisma : aucune différence détectée.
- Seed initial et relances réussis ; base applicative conservée à 12 produits, 2 profils et 146 clés disponibles après les tests isolés.
- 11 tests unitaires réussis : moteur local, chiffrement et protection du seed.
- 10 tests PostgreSQL réussis : contraintes, concurrence, instantanés, appartenance des emails et seed non destructif.
- 10 tests navigateur réussis : parcours de présentation FR/EN et administration.
- Validation du schéma, vérification TypeScript et build de production réussis.
- Audit npm des dépendances de production : aucune vulnérabilité signalée.
- Contrôle des 54 fichiers JavaScript du navigateur : aucune valeur privée de configuration détectée.
- Fichier `.env` local avec permissions `600`, ignoré par Git.

La connexion distante à Neon, l’authentification réelle et le branchement des pages ne sont pas revendiqués par ces vérifications.
