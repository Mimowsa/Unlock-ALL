# Phase 9 — Paiement PayPal Sandbox

Le parcours PayPal est disponible dans la maquette. Les produits et les clés restent fictifs et aucun argent réel n’est débité. Les appels PayPal sont limités à `api-m.sandbox.paypal.com` ; le mode Live est refusé.

## Utiliser le parcours

1. Se connecter à la maquette et ajouter un produit au panier.
2. Renseigner Discord et accepter les conditions de démonstration.
3. Choisir **Tester avec PayPal Sandbox**.
4. Se connecter chez PayPal avec un **compte acheteur Personal Sandbox**, puis approuver le paiement fictif. Les comptes acheteur/vendeur de test se trouvent dans PayPal Developer → Testing Tools → Sandbox Accounts ([documentation](https://developer.paypal.com/sandbox-testing/accounts)).
5. Le retour sur la maquette déclenche la vérification côté serveur. Les clés sont livrées uniquement après confirmation de la capture et restent accessibles dans Mes commandes.

Une tentative en attente peut être reprise dans Mes commandes, même si la fenêtre PayPal a été fermée. Les paiements sont consultables dans **Administration → Paiements PayPal** : montant, statut, compte Business utilisé, références de commande et capture, code d’erreur filtré et vérification manuelle. Les commandes terminées affichent aussi la source du paiement.

## Configuration et processus locaux

Dans le fichier `.env` privé :

```env
APP_MODE=demo
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=identifiant_sandbox
PAYPAL_CLIENT_SECRET=secret_sandbox
PAYPAL_CHECKOUT_ENABLED=false
```

```bash
npm run db:migrate
npm run paypal:check
npm run paypal:configure -- --label="Sandbox A"
npm run dev
npm run paypal:reconcile -- --watch
```

`paypal:check` vérifie les identifiants, le destinataire et le parcours de redirection avec des commandes techniques non approuvées. Il ne capture aucun paiement. `paypal:configure` vérifie le compte, chiffre les identifiants en base et active les nouveaux paiements Sandbox locaux. Ce script refuse la production, Vercel et les bases/origines non locales. Aucun secret ne doit être communiqué dans le chat, publié dans Git ou placé dans une variable `NEXT_PUBLIC_`.

Le processus `paypal:reconcile -- --watch` doit rester ouvert en local pour suivre les retours interrompus et libérer les réservations expirées sans navigation. Sans `--watch`, il traite un lot. Le worker email peut continuer à fonctionner ; les verrous de la file empêchent les envois dupliqués.

## Réservation, validation et livraison

La préparation relit le panier et les prix depuis PostgreSQL, vérifie sa révision/empreinte et verrouille les produits. Elle réserve une clé chiffrée par unité pendant 30 minutes. Ces clés sont exclues du stock disponible pour les autres paniers, simulations et paiements. Leur désactivation ou leur utilisation par une autre commande est interdite par PostgreSQL. Aucun ordre local terminé ni attribution définitive n’est créé à ce stade.

L’identifiant, les prix, quantités, traductions, plateforme, jeu, téléchargement, compte marchand et corps de création PayPal sont figés. La requête PayPal utilise un identifiant d’idempotence stable. Une création répétée avec le même identifiant retrouve la tentative ; une demande différente est refusée.

Le serveur relit la commande auprès de PayPal avec les identifiants du compte d’origine, vérifie le destinataire marchand, la référence locale, le montant EUR et la devise. Il capture uniquement une commande approuvée. Après la capture, il relit sa représentation complète et exige une capture finale, terminée, unique et du montant exact. Un simple retour du navigateur, un statut d’approbation ou un identifiant fourni par le client ne suffisent jamais pour livrer les clés.

La capture PayPal est enregistrée avant la transaction de livraison. Cette transaction crée les instantanés de commande, attribue les clés réservées, termine la commande et prépare les emails. Une erreur SQL remet toute cette livraison en arrière ; la reprise utilise le paiement déjà capturé et ne débite ni n’attribue une deuxième fois. Le panier est vidé si sa révision et son empreinte n’ont pas changé ; un panier modifié depuis la réservation est conservé.

Les réponses incertaines conservent la même tentative et les réservations. Les opérations ont un bail, et la source de paiement, ses références et ses instantanés sont protégés contre les réécritures. Une capture encore incertaine n’est pas relancée après cinq heures : PayPal annonce une conservation par défaut de six heures des identifiants de requête ([documentation](https://developer.paypal.com/sdk/orders/v2/orders-create/)). Une intervention devient nécessaire plutôt que de risquer une nouvelle opération avec un identifiant neuf.

Une annulation avant capture, une expiration sans capture commencée ou un refus certain libèrent les réservations et conservent le panier. Une erreur de vérification, un montant incohérent ou un paiement potentiellement capturé conservent les clés en attente de rapprochement. Aucune réussite n’est annoncée sans preuve de capture. Les remboursements d’un paiement terminé peuvent être rapprochés depuis l’administration ; ils ne suppriment jamais les clés déjà livrées ni les anciennes commandes. Cette phase ne déclenche pas de remboursement automatique.

## Changer de compte Business

La bascule est manuelle et versionnée. Elle n’efface pas les comptes précédents :

1. Suspendre les nouvelles préparations avec `PAYPAL_CHECKOUT_ENABLED=false`, puis redémarrer le serveur.
2. Sauvegarder la base et les secrets de chiffrement.
3. Remplacer les deux identifiants Sandbox dans `.env` par ceux du nouveau compte/application. Retirer l’ancien `PAYPAL_WEBHOOK_ID` si l’application change.
4. Exécuter `npm run paypal:configure -- --label="Sandbox B"`.
5. Redémarrer le serveur et le processus de rapprochement, puis vérifier une nouvelle commande Sandbox.

Les nouvelles tentatives utilisent le nouveau compte. Les tentatives déjà préparées, leurs captures, les vérifications et les anciens événements gardent leur compte d’origine. Les identifiants historiques sont chiffrés et ne sont jamais renvoyés aux interfaces. Garder l’accès aux anciennes applications/comptes pour le suivi des opérations et des remboursements. Un changement de secret dans la même application doit être traité explicitement : le script refuse de remplacer silencieusement les identifiants d’une version existante.

## Webhooks et hébergement

La route `/api/paypal/webhooks/:merchantId` vérifie les notifications auprès de PayPal avec le `webhookId` et les identifiants de l’application d’origine. Les signatures incorrectes sont refusées ; les événements sont enregistrés une seule fois et les références du corps ne déclenchent aucune livraison sans relecture serveur du paiement. Les URLs de certificat sont limitées au domaine API Sandbox ; elles ne sont pas téléchargées par l’application.

PayPal exige une URL publique HTTPS pour les notifications ([documentation](https://developer.paypal.com/api/rest/webhooks/rest/)). **Aucun webhook externe n’est enregistré sur localhost dans cette livraison.** Le rapprochement local remplit cette fonction pendant les essais. Lorsqu’une URL HTTPS sera disponible, enregistrer l’URL de la route dans l’application PayPal, ajouter son identifiant `PAYPAL_WEBHOOK_ID`, puis relancer la configuration du compte concerné. L’identifiant interne du compte est visible dans Prisma Studio ou le résultat de `paypal:configure`.

## Vérifications et limites de cette livraison

Les tests automatisés utilisent des fournisseurs PayPal simulés et des schémas PostgreSQL jetables. Ils couvrent : accès propriétaire/admin, refus du mode Live, prix falsifiés, montant/devise/destinataire incohérents, double validation, stocks concurrents, réponse de capture perdue, retour arrière après une erreur SQL, annulation sans capture, rotation de compte, signature et déduplication des événements, remboursements et rendu mobile.

Une vérification réelle de l’API Sandbox a confirmé l’authentification, la création et la redirection. **Aucune connexion ni approbation avec un compte acheteur Sandbox n’a été automatisée.** Le parcours réel de validation finale est à effectuer avec ce compte de test.

La migration 7 ajoute les comptes marchands, tentatives, réservations, événements et protections SQL. Le schéma Prisma correspond à la base appliquée. Aucun paiement réel ni déploiement n’a été activé. L’activation commerciale nécessitera une configuration et une validation distinctes ; remplacer simplement les clés par des clés Live ne l’active pas.

La suite du planning est : **phase 10 — vérifications globales et paiements de test**, puis **phase 11 — préparation du déploiement Vercel/Neon et validation du passage commercial**.

Validation réalisée : **132 tests réussis** (27 unitaires, 60 PostgreSQL et 45 navigateur), TypeScript et build de production. Les essais réels d’API n’ont créé que des commandes techniques non approuvées ; aucune capture réelle Sandbox n’a été exécutée par l’agent.

Captures : [commande mobile](apercu-phase-9-paypal-mobile.png), [confirmation mobile](apercu-phase-9-confirmation-mobile.png) et [administration mobile](apercu-phase-9-admin-mobile.png).
