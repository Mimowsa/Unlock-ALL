# Phase 5 — Catalogue et administration PostgreSQL

État livré en phase 5. Les stocks et paniers sont désormais connectés en [phase 6](phase-6.md).

Le catalogue public, les formulaires de produits, les indicateurs du dashboard et les comptes administrés utilisent maintenant PostgreSQL. Aucun paiement, email ou déploiement n’est ajouté. Les stocks modifiables, le panier et les commandes du parcours de présentation restent locaux jusqu’aux phases 6 et 7.

## Utiliser la phase 5

```bash
npm run db:local:start
npm run dev
```

- Boutique : http://127.0.0.1:3000/fr/boutique
- Produits : http://127.0.0.1:3000/fr/admin/produits
- Utilisateurs : http://127.0.0.1:3000/fr/admin/utilisateurs
- Vue d’ensemble : http://127.0.0.1:3000/fr/admin

Se connecter avec un compte ADMIN. Si aucun compte n’a été provisionné, exécuter `npm run auth:admin` : la saisie du mot de passe est masquée. Les profils initiaux fictifs restent sans accès de connexion.

Pour vérifier visuellement les écritures : `npm run db:studio`, puis http://localhost:5555. Consulter `Product`, `ProductTranslation`, `ProductImage`, `ProductImageTranslation`, `User` et `AuditLog`. Aucune migration supplémentaire n’est nécessaire : les quatre migrations précédentes couvrent ces fonctions.

## Catalogue public

Le layout serveur charge uniquement les produits de démonstration au statut `PUBLISHED`. L’API publique `GET /api/catalog` suit le même filtre. Les brouillons et produits archivés ne sont jamais envoyés aux visiteurs dans le catalogue ou les données du layout. Les pages produit vérifient aussi leur publication côté serveur et retournent une page introuvable si le slug est absent ou désactivé.

Les filtres, la recherche et le tri utilisent ce catalogue PostgreSQL en conservant leurs paramètres dans l’URL. Les illustrations de l’accueil ne dépendent plus d’identifiants de fixtures. Le catalogue est rafraîchi lors d’une navigation et après une modification administrateur ; un rechargement consulte de nouveau la base. Les réponses API utilisent `Cache-Control: no-store`.

Les données de catalogue du stockage local ne sont jamais la source des prix, noms ou statuts de publication. Les anciens identifiants des paniers locaux sont rapprochés des identifiants de produits déjà créés en phase 3 ; les références devenues indisponibles sont retirées du panier. Les instantanés des anciennes commandes locales restent consultables.

Le catalogue nécessite désormais PostgreSQL. Une erreur de connexion n’entraîne aucun retour silencieux au catalogue fictif. Les listes administrateur présentent un message d’erreur et une action Réessayer. Une erreur d’enregistrement conserve les champs saisis et n’affiche pas de réussite.

## Gestion des produits

L’administration permet de créer et modifier :

- le slug unique et les noms FR/EN ;
- les descriptions FR/EN et le prix entier en centimes ;
- la plateforme PC, PlayStation ou Xbox et une des quatre catégories ;
- l’image importée (PNG, JPG ou WebP, 5 Mo maximum) ou une illustration parmi les quatre SVG originaux livrés ;
- la publication ou désactivation ;
- le lien vers le fichier de démonstration livré.

Les prix sont compris entre 0 et 100 000 000 centimes. Les noms acceptent 150 caractères et les descriptions 2 000 caractères par langue. Chaque enregistrement met à jour les deux traductions et les textes alternatifs de l’illustration principale dans la même transaction. Le jeu reste Call of Duty dans cette version. L’import d’une image produit est disponible ; les URLs externes ne sont pas acceptées. Le seul fichier de téléchargement configuré est `/downloads/demo/unlock-all-demo.txt`.

La désactivation transforme le produit en brouillon (`DRAFT`) et le retire de la boutique. Aucune suppression de produit n’est proposée, afin de préserver les références et instantanés des commandes.

Les modifications comportent la date `updatedAt` lue à l’ouverture. Le serveur verrouille la ligne et refuse avec 409 une version devenue ancienne ; il n’écrase pas silencieusement les changements d’un autre administrateur. Un slug déjà utilisé produit aussi un conflit. Une création ou modification et son `AuditLog` sont validés ensemble ; un échec annule l’ensemble.

## Ajouter une image produit

Dans `/fr/admin/produits`, les lignes affichent maintenant une miniature. Cliquer sur Modifier ou Créer un produit, puis sur **Ajouter une image**, choisir un PNG, JPG ou WebP de 5 Mo maximum et cliquer sur **Enregistrer**. L’aperçu affiche l’image avant validation du produit. Le bouton « Revenir au visuel prédéfini » permet de réutiliser une illustration livrée. Les textes et contrôles existent en français et en anglais.

L’API ADMIN `POST /api/admin/product-images` contrôle la session, l’origine et une limite persistante de 30 imports sur 15 minutes. Elle vérifie les octets et le format réels avec Sharp 0.35.5, refuse les fichiers invalides et les animations, limite le décodage à 25 millions de pixels, retire les métadonnées et réencode l’image en WebP, dans un carré maximal de 1 600 pixels sans agrandissement. Le nom du fichier original n’est pas conservé. Chaque import est journalisé.

Les fichiers sont stockés dans `.local/product-images/` et servis publiquement via `/api/media/products/[filename]` avec un nom aléatoire. Leur URL est enregistrée dans `ProductImage` au moment de valider le produit, puis utilisée dans la boutique et la fiche produit. `PRODUCT_IMAGES_DIR` peut désigner un volume persistant. Ce stockage convient au développement local ; avant un hébergement sur plusieurs instances ou Vercel, il faudra un stockage objet partagé. Sauvegarder ce dossier avec la base. Les images importées puis abandonnées ou remplacées restent sur disque ; aucun effacement automatique ne risque de casser une image encore utilisée.

Les tests navigateur utilisent un dossier temporaire dédié, supprimé après la suite. Ils vérifient l’import depuis le formulaire, la conversion, les miniatures, l’aperçu mobile, la persistance pour un visiteur et les refus de fichiers invalides, trop volumineux ou d’URLs forgées.

## Utilisateurs réels

La liste interroge PostgreSQL avec recherche par adresse ou pseudonyme et pages de 25 comptes. Elle ne retourne ni hash de mot de passe, ni jeton, ni données de session. Ses résultats restent en mémoire et ne sont pas enregistrés dans `localStorage`.

Les changements de rôle USER/ADMIN et d’activation utilisent une API protégée. Ils sont confirmés dans l’interface, validés côté serveur, contrôlés par version, journalisés et rendent les sessions précédentes invalides grâce au trigger de la phase 4. Les profils initiaux fictifs sont affichés en lecture seule ; le provisionnement d’un administrateur passe toujours par la commande dédiée. Le dernier administrateur actif ne peut être rétrogradé ou désactivé, y compris sous concurrence.

## Dashboard

Les compteurs et les cinq dernières commandes de démonstration sont lus dans une transaction PostgreSQL cohérente : utilisateurs, commandes, terminées, échouées, produits publiés disponibles ou en rupture et somme des commandes terminées. Les montants restent explicitement des valeurs simulées. Les totaux monétaires sont transmis par l’API sous forme de chaînes décimales pour sérialiser les `BigInt` sans erreur JSON.

Un produit disponible possède au moins une clé de démonstration non désactivée et non attribuée en base. Ce compteur du dashboard est déjà réel ; les contrôles de stock visibles dans le parcours de simulation restent locaux jusqu’à la phase 6. Les commandes simulées uniquement dans le navigateur ne modifient donc pas les indicateurs PostgreSQL.

## APIs et contrôle d’accès

| Méthode    | Route                         | Accès                               |
| ---------- | ----------------------------- | ----------------------------------- |
| GET        | `/api/catalog`                | Public, produits publiés uniquement |
| GET / POST | `/api/admin/products`         | ADMIN                               |
| PATCH      | `/api/admin/products/[id]`    | ADMIN                               |
| GET        | `/api/admin/users?q=…&page=…` | ADMIN                               |
| PATCH      | `/api/admin/users/[id]`       | ADMIN                               |
| GET        | `/api/admin/overview`         | ADMIN                               |

Les invités reçoivent 401, les comptes USER 403. Chaque API vérifie sa session côté serveur. Les écritures revérifient l’état actif et le rôle de l’acteur dans la transaction ; une valeur de rôle du navigateur ne détermine jamais ses autorisations. Les mutations imposent l’origine canonique, le JSON et une validation Zod stricte. Les champs supplémentaires sont rejetés. Les produits autorisent un corps maximal de 32 Kio pour les descriptions Unicode ; les autres APIs conservent leur limite de 8 Kio. Les écritures sont limitées à 100 opérations par administrateur sur 15 minutes, avec compteurs PostgreSQL persistants.

Les réponses sont privées et non mises en cache. Aucune clé d’activation, empreinte ou donnée de chiffrement n’est chargée par le catalogue. Les erreurs applicatives restent génériques et les entrées sensibles ne sont pas imprimées dans les logs.

## Vérifier

```bash
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e
npm run db:check
```

Les tests SQL et navigateur utilisent chacun un schéma temporaire et le suppriment à la fin. La suite navigateur initialise son propre catalogue de 12 produits et 146 clés chiffrées avec des secrets éphémères ; elle ne modifie pas la base de l’application. Son serveur utilise le port 3100.

Les nouveaux tests couvrent la persistance entre navigateurs, les traductions et images, la confidentialité des brouillons, les accès invités et USER, les saisies malveillantes, les conflits de modification, les versions de comptes, les indicateurs PostgreSQL et les erreurs réseau des formulaires.

Vérification finale du 20 octobre 2026 : compilation et TypeScript réussis ; 11 tests unitaires, 20 tests PostgreSQL et 30 tests navigateur réussis, soit **61 tests**. Les quatre migrations sont à jour. La base applicative contient toujours ses 12 produits et 146 clés disponibles, sans clé attribuée par les tests. Le catalogue et son API répondent avec succès sur le serveur de développement. Les cinq secrets et chaînes de connexion configurés ont été recherchés dans les 70 fichiers du bundle client : aucune exposition détectée.

Les captures de contrôle ont été inspectées : [dashboard](apercu-phase-5-dashboard.png) et [produits sur mobile](apercu-phase-5-produits-mobile.png), ainsi que le [formulaire d’import d’image sur mobile](apercu-phase-5-images-mobile.png). Les données visibles sur ces captures proviennent exclusivement du schéma de test.

## Phase suivante

La phase 6 connectera les stocks de démonstration et le panier à PostgreSQL avec vérifications serveur. La création transactionnelle des commandes et l’attribution des clés restent prévues en phase 7. Les écrans encore locaux portent une indication explicite. Le bouton de réinitialisation locale ne modifie aucun produit, compte, clé ou ordre en base.
