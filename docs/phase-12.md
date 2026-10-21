# Phase 12 — paiement PayPal par référence

Le nouveau panier prépare un envoi manuel sur le compte Business Sandbox. Le client reçoit le destinataire, le montant exact en euros et une référence unique à copier seule dans la note PayPal. Le site ne capture plus une nouvelle commande PayPal Checkout. Les anciennes tentatives conservent leur suivi et leurs liens historiques.

## Activation opérateur

Dans Apps & Credentials, ouvrir l’application Sandbox correspondant aux identifiants du fichier opérateur, activer Transaction Search puis enregistrer. Appliquer les migrations et vérifier réellement l’accès avant d’ouvrir les nouvelles tentatives :

```bash
node --env-file=.env.hosted node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.hosted --experimental-strip-types scripts/configure-paypal-reference.ts --hosted-sandbox
```

Le script utilise une commande technique non approuvée de 0,01 € pour vérifier l’identité et l’email du destinataire, puis interroge Transaction Search. Il ne capture aucun paiement. Il active le compte pour ce parcours uniquement si les deux vérifications réussissent. Un refus 403 laisse le paiement par référence indisponible ; l’option cochée dans le tableau de bord ne suffit pas à prouver l’autorisation effective de l’API.

Les variables existantes restent utilisées : mode démonstration, `PAYPAL_ENV=sandbox` et `PAYPAL_CHECKOUT_ENABLED=true`. Les identifiants API et le destinataire vérifié sont conservés côté serveur ; chaque tentative fige son compte Business et son email destinataire. Pour un nouveau compte complet, utiliser ses nouveaux identifiants dans le fichier opérateur et relancer cette configuration. Conserver les anciennes versions chiffrées et leur accès API pour les paiements en cours. Le mode Live reste refusé.

## Règles de rapprochement

- Une tentative active par client. Les prix et les réservations sont calculés par le serveur, jamais fournis comme preuve par le navigateur.
- Le client dispose de 30 minutes pour envoyer le montant exact et la référence. Choisir un paiement de biens et services dans Sandbox.
- Les clés restent réservées pendant au moins quatre heures. PayPal indique que les transactions peuvent mettre jusqu’à trois heures à apparaître dans Transaction Search ([documentation officielle](https://developer.paypal.com/api/transaction-search/v1/search-get)).
- Le serveur exige le bon compte, la référence exacte, le montant brut exact, EUR, un paiement général `T0000`, le statut réussi `S` et une date dans la fenêtre d’envoi. Une note absente, un paiement en attente, une ambiguïté ou un autre type de transaction ne livre aucune clé.
- Une transaction ne peut servir qu’une fois. Sa preuve est enregistrée avant la livraison ; les contraintes PostgreSQL empêchent une validation sans preuve correspondante. La livraison reste atomique et peut reprendre après une erreur sans doubler les clés.
- Une expiration libère les réservations uniquement après un rapport complet suffisamment récent ne contenant aucun paiement correspondant. Une panne ou un refus de l’API conserve les réservations. Le client ne peut pas annuler une référence déjà affichée.
- Une anomalie passe en contrôle manuel. Aucun bouton administrateur ne permet d’affirmer un paiement sans preuve. Les remboursements et litiges de ces envois manuels nécessitent un suivi opérateur ; ce parcours n’implémente pas leur traitement automatique.

Les rapports sont paginés et limités à cinq pages de 100 entrées par interrogation. Un rapport incomplet ou dépassant cette limite est refusé. La maquette nécessite donc un faible volume. La fenêtre maximale de recherche est de 31 jours ; les anomalies durables doivent être traitées par l’opérateur avant cette limite. Les références expirées sont encore suivies pendant leur première journée pour signaler une apparition tardive, sans attribuer automatiquement de clés après libération du stock.

## Traitement sans navigateur ouvert

Le workflow `.github/workflows/background-jobs.yml` appelle les deux routes protégées de traitement. Configurer le secret GitHub `UNLOCK_ALL_CRON_SECRET` avec la même valeur privée que `CRON_SECRET` sur Vercel. Il utilise une fréquence de cinq minutes ; GitHub peut retarder les exécutions planifiées ([documentation GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)). Les contrôles serveur restent limités à deux paiements par appel et une vérification par minute et par tentative. Ce planificateur convient à la maquette ; surveiller les files avant d’augmenter le trafic.

La page ouverte affiche aussi l’état et propose une vérification manuelle. Le client retrouve ses instructions dans Mes commandes. Aucun email, capture d’écran ou message du navigateur n’est accepté comme preuve de paiement.

## Essai avant ouverture

Après réussite de la configuration et déploiement, utiliser un acheteur Personal Sandbox distinct du Business destinataire. Créer une tentative, copier la référence seule dans la note et envoyer le montant exact au destinataire affiché. Vérifier ensuite que le rapport réel fournit les champs attendus, que les clés arrivent une seule fois et qu’elles restent accessibles après rechargement. Effectuer un autre essai navigateur fermé pour contrôler le planificateur. Les tests automatisés avec fournisseur simulé ne remplacent pas cet essai réel Sandbox.

## Validation de cette version

Les 41 tests unitaires, 80 tests PostgreSQL et 45 tests navigateur passent, soit 166 tests, avec TypeScript et compilation de production validés. Les migrations et la configuration Transaction Search ont été appliquées sur Neon et en local ; l’accès au rapport réel du compte Sandbox est vérifié. La capture [mobile](apercu-phase-12-reference-mobile.png) utilise uniquement des données de test. Le nouveau paiement manuel complet avec un acheteur Sandbox reste à essayer après déploiement.
