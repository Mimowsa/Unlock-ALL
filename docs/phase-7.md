# Phase 7 — Commandes simulées

La validation du panier crée désormais une commande PostgreSQL. Aucun paiement, email ou appel à un jeu n’est effectué.

## Utilisation

La démonstration locale s’active avec `npm run demo:configure`, puis `npm run dev`. Se connecter, ajouter des produits, ouvrir la commande, renseigner un Discord fictif et confirmer les conditions. La confirmation affiche les clés effectivement attribuées depuis le stock chiffré. Le panier est vidé après réussite. Les commandes restent accessibles dans **Mon compte → Mes commandes** sur les autres navigateurs connectés au même compte.

L’administration permet de rechercher par référence ou email, filtrer par résultat, paginer et ouvrir le détail. Les consultations des clés de commande sont auditées. Les téléchargements sont réservés au propriétaire ou à un administrateur réel.

## Transaction et reprises

`src/server/commerce/orders.ts` verrouille le compte, le panier, les produits dans un ordre stable et les clés disponibles. Prix, publication, mode, quantités et totaux sont relus côté serveur. Le client ne peut pas fournir le prix, les clés, le rôle ou le mode de paiement. La révision et une empreinte du panier/prix détectent les changements depuis l’affichage.

La transaction conserve les noms FR/EN, plateforme, jeu, prix et chemin de téléchargement dans les lignes de commande. Elle sélectionne et vérifie toutes les clés avant la première attribution, attribue une clé distincte par unité puis termine la commande et vide le panier. Les contraintes SQL existantes interdisent la double attribution et valident la correspondance quantité/clés/totaux à la validation de la transaction.

Chaque tentative possède un UUID d’idempotence associé au compte et à l’empreinte de la demande. Une reprise identique retrouve la commande, même si le panier a été vidé. Un contenu différent avec le même identifiant est refusé. Après une réponse réseau incertaine, l’interface conserve la tentative et propose **Réessayer la même commande**. Le contrôle d’idempotence précède celui des nouvelles simulations : un résultat déjà enregistré reste récupérable après désactivation de la démo.

Une rupture enregistre `FAILED`, ne livre aucune clé et conserve le panier. Une clé chiffrée illisible enregistre `NEEDS_ATTENTION`, sans attribution, et apparaît comme un échec au client. Une erreur SQL interrompt toute la transaction : aucune commande ou attribution partielle n’est conservée et la même tentative peut être réessayée. Les autres étapes `CREATING`, `VALIDATED`, `ASSIGNING`, `DELIVERING`, `COMPLETED` restent internes. Les événements sont ajoutés au journal sans stocker de clé en clair.

## Accès et configuration

- `POST /api/orders` : compte connecté, JSON de même origine, validation stricte et limite persistante de tentatives.
- `GET /api/orders` et `GET /api/orders/:id` : uniquement les commandes du compte ; les listes ne contiennent aucune clé.
- `GET /api/admin/orders` et `GET /api/admin/orders/:id` : rôle ADMIN vérifié côté serveur.
- `GET /api/orders/:id/download/:itemId` : commande terminée appartenant au compte, ou administrateur. Réponses privées sans cache.

La livraison reconnaît uniquement le chemin virtuel `/downloads/demo/unlock-all-demo.txt`. Le fichier se trouve maintenant dans `assets/downloads/`, hors du dossier public. Un chemin externe ou arbitraire n’est jamais utilisé pour lire un fichier.

Les commandes exigent **simultanément** `APP_MODE=demo`, `DEMO_CHECKOUT_ENABLED=true` et `SiteSetting.demoEnabled=true`. Le serveur impose `mode=DEMO` et `paymentStatus=NOT_REQUIRED`. Les valeurs par défaut restent désactivées. Le script d’activation refuse les bases et origines non locales, la production et Vercel. Désactivation : `npm run demo:configure -- --disable`.

Les commandes et leurs clés ne sont jamais enregistrées dans `localStorage`. Les anciens aperçus ne sont pas importés. Sauvegarder PostgreSQL, les secrets de chiffrement, les images locales et les fichiers privés avant un nettoyage ou un changement d’hébergement.

## Vérification

`npm run test:db` utilise un schéma éphémère et vérifie attribution multiple, concurrence sur la dernière clé, idempotence, instantanés, accès propriétaire/admin, garde du mode démo, clé illisible et retour arrière après une erreur au milieu de l’attribution. Les tests navigateur vérifient aussi le parcours, les téléchargements, les reprises réseau et les largeurs 320/1440 px. Exécuter `npm run build` avant `npm run test:e2e`.

Aucune nouvelle migration n’est nécessaire : les cinq migrations existantes comprennent déjà les tables de commandes, leurs contraintes et les événements. Aucun email n’est créé ou annoncé comme envoyé ; la phase 8 traitera cet envoi séparément.

Validation réalisée : 11 tests unitaires, 34 tests PostgreSQL et 39 tests navigateur, soit **84 tests**, ainsi que TypeScript et le build de production. Les tests utilisent des données éphémères ; aucune commande n’a été créée dans votre base de travail pour ces vérifications.

Captures de contrôle : [confirmation](apercu-phase-7-confirmation.png) et [confirmation mobile](apercu-phase-7-confirmation-mobile.png).
