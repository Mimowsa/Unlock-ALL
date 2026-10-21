# Phase 8 — Emails Resend

Les quatre emails sont disponibles en HTML et texte, en français et en anglais : bienvenue, confirmation de commande simulée, livraison des clés et réinitialisation du mot de passe. Le style reprend les couleurs sombres et violettes de la maquette. Aucun paiement n’est ajouté.

## Configuration locale

Le fichier `.env` privé contient :

```env
APP_MODE=demo
EMAIL_DELIVERY=resend-test
RESEND_API_KEY=re_votre_cle_privee
EMAIL_TEST_RECIPIENT=votre-adresse-de-compte-resend@example.com
AUTH_RESET_DELIVERY=email
```

Ne pas publier la clé ni lui donner un préfixe `NEXT_PUBLIC_`. La configuration initiale se fait avec :

```bash
npm run email:configure -- --recipient=votre-adresse-de-compte-resend@example.com
npm run dev
```

L’expéditeur de test est `UNLOCK-ALL <onboarding@resend.dev>`. Resend limite cet expéditeur à l’adresse du compte qui a créé la clé API ([documentation officielle](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). Les emails des autres comptes ne sont jamais redirigés vers la boîte de l’opérateur : ils ne sont pas mis en file et l’interface explique cette limitation. Un domaine vérifié et une configuration d’envoi distincte seront nécessaires pour ouvrir les envois à d’autres destinataires.

Désactivation : `EMAIL_DELIVERY=none`, puis redémarrer le serveur et le worker. Pour retrouver la boîte privée de réinitialisation en développement, définir aussi `AUTH_RESET_DELIVERY=local` ; le mode local reste interdit en production et sur Vercel.

## Traitement et reprises

`EmailJob` est une file persistante dans PostgreSQL. L’inscription crée le compte et son email de bienvenue dans la même transaction. Une commande terminée crée deux tâches uniques, confirmation et livraison, dans la transaction d’attribution. Une reprise de commande ne crée pas de tâche ou de clé supplémentaire. Les commandes échouées ne créent pas d’emails de livraison.

Les routes déclenchent un traitement court avec `after()` de Next.js après leur réponse. Un worker durable traite les nouvelles tentatives même sans navigation :

```bash
npm run email:worker -- --watch
```

Pour traiter seulement un lot : `npm run email:worker`. Le processus continu doit rester ouvert pour les reprises automatiques ; la phase de déploiement devra prévoir un worker ou un ordonnanceur adapté. Un verrou de worker et des baux de tâches évitent le traitement simultané. Les requêtes sont espacées de 600 ms dans un lot ; les erreurs réseau, 429, 409 et 5xx font l’objet de reprises, avec cinq tentatives maximum et des délais de 1, 5, 15 et 60 minutes. Les erreurs permanentes ne sont pas répétées automatiquement.

Chaque requête utilise une clé d’idempotence stable et un corps figé avant son premier envoi. Ce corps, susceptible de contenir des clés ou un lien personnel, est chiffré avec AES-GCM, une clé dérivée pour les emails et une association à l’identifiant de la tâche. Il est supprimé après acceptation par Resend. Les liens de réinitialisation sont chiffrés dès leur mise en file ; la table des jetons conserve uniquement leur empreinte.

Resend conserve ses clés d’idempotence pendant 24 heures ([documentation](https://resend.com/docs/dashboard/emails/idempotency-keys)). Après 23 heures depuis une première tentative, une tâche incertaine est arrêtée avec `RECONCILIATION_REQUIRED` et demande une vérification opérateur. Aucun nouvel envoi automatique avec un identifiant neuf n’est effectué. Les erreurs de transport ne stockent ni la réponse brute de Resend ni son message contenant potentiellement des données privées.

Une erreur d’email ne change jamais une commande terminée et ne réattribue aucune clé. Les clés restent accessibles dans Mes commandes et les erreurs liées à une commande sont journalisées avec un code filtré.

## Réinitialisation du mot de passe

La demande renvoie le même message conditionnel pour une adresse connue, inconnue ou non autorisée pour les tests. Elle ne prétend pas qu’un email est déjà envoyé. Un lien expire après 20 minutes, est utilisable une seule fois et une nouvelle demande invalide les précédents liens. Les messages expirés ou remplacés ne sont pas envoyés.

`npm run auth:cleanup` nettoie aussi les secrets des messages de réinitialisation expirés avant de supprimer les anciens jetons. Le worker nettoie ces messages également. Les corps de messages en erreur sont supprimés une fois leur fenêtre de reprise dépassée.

## Suivi dans l’application

Le détail de commande distingue : aucun envoi, adresse restreinte, attente, erreur et acceptation des deux messages par Resend. L’écran actualise les envois en attente. **Accepté par Resend ne signifie pas reçu dans la boîte de réception** : cette phase ne comporte pas de suivi des événements de réception ou de rebond par webhook.

Un administrateur voit le type, le statut, le nombre de tentatives et le code d’erreur. Le bouton de reprise refuse les tâches dont la fenêtre ou le nombre maximal de tentatives sont dépassés. L’API de reprise exige un véritable rôle ADMIN, une requête JSON de même origine et applique une limite persistante de tentatives. Le client ne peut changer ni le destinataire, ni les clés, ni le contenu du message.

## Prévisualisation et vérification

```bash
npm run email:preview
npm run email:test
npm test
npm run test:db
npm run build
npm run test:e2e
```

Les huit modèles sont générés dans `.local/email-previews/` avec des données entièrement fictives. Le test de connexion envoie un seul message technique à l’adresse autorisée, sans créer de compte ni de commande. Son identifiant est conservé en privé pour éviter un doublon en cas de reprise. Un test accepté n’est pas envoyé une deuxième fois.

Les suites automatisées désactivent les envois réels, utilisent des secrets éphémères et des schémas SQL temporaires. Elles vérifient les reprises, le corps identique, les accès, les limites de test, l’absence de réattribution des clés, les liens à usage unique et le rendu des huit modèles à 320 et 1440 px.

La sixième migration ajoute les champs de suivi/chiffrement et le verrou du worker. Les connexions Prisma utilisent désormais UTC pour conserver la même horloge absolue que les comparaisons SQL des tâches planifiées ; aucun historique existant n’a été réécrit.

Validation réalisée : **108 tests réussis** (22 unitaires, 44 PostgreSQL et 42 navigateur), TypeScript et build de production validés. Le test technique réel a été accepté par Resend après configuration du destinataire exact de son compte. Aucune commande ni attribution de clé n’a été créée dans la base de travail par ces vérifications.

Captures : [email de livraison](apercu-phase-8-email.png) et [version mobile](apercu-phase-8-email-mobile.png).
