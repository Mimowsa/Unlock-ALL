# Phase 10 — Vérification globale de la maquette

## État de la validation

Vérification automatisée effectuée le 21 octobre 2026. Les suites utilisent des schémas PostgreSQL temporaires, des secrets éphémères et des fournisseurs email/PayPal simulés. Elles ne consomment pas le stock de la maquette et n'envoient aucun email réel. Elles ne remplacent pas un essai complet chez PayPal avec un acheteur Sandbox.

| Vérification | Résultat |
| --- | --- |
| Tests unitaires : moteur, chiffrement, emails FR/EN, PayPal | 27 réussis |
| Tests PostgreSQL : contraintes, services et concurrence | 66 réussis |
| Tests navigateur Chrome : comptes, catalogue, panier, commandes, administration, emails et PayPal | 45 réussis |
| TypeScript | Réussi |
| Build de production | Réussi |
| Migrations locales | 7 migrations appliquées, à jour |
| Approbation réelle avec un compte acheteur Personal Sandbox | Confirmée par l'utilisateur : paiement approuvé et clés reçues |

Les 138 tests couvrent notamment les prix falsifiés, les accès à une commande d'un autre client, la révocation des sessions, les doubles validations, les stocks concurrents, les clés distinctes par unité, les téléchargements privés, les erreurs SQL après capture, les réponses réseau perdues, les reprises email et le changement de compte marchand. Les contrôles d'affichage incluent FR/EN et les largeurs 320, 768, 1024 et 1440 px. La suite navigateur utilise Chrome ; aucune certification multi-navigateur ou charge de production n'est annoncée.

## Corrections apportées

L'expiration d'une tentative ne libère plus ses clés pendant qu'un autre traitement possède un bail actif, y compris pendant la création de la commande distante. Le traitement propriétaire peut terminer sa propre expiration. Une capture déjà commencée interdit la libération par ce mécanisme, même après expiration du bail.

Une notification de remboursement peut contenir l'identifiant du remboursement plutôt que celui de la capture. Le serveur retrouve maintenant la capture depuis les références associées ou le lien parent `rel=up`, puis vérifie auprès de PayPal son identifiant, son montant et sa devise avant de modifier le statut. Seuls les liens parents de l'API Sandbox sont reconnus ; aucune URL contenue dans la notification n'est téléchargée. Les clés et la commande livrées restent conservées. Le format du lien parent est documenté par [PayPal Payments v2](https://developer.paypal.com/api/payments/v2/captures-refund).

Six nouveaux tests PostgreSQL couvrent ces cas : les deux domaines API Sandbox, la conservation des réservations pendant un bail actif ou une capture incertaine, le rejet d'un domaine parent étranger et un montant de capture incohérent. Une incohérence de capture laisse l'événement non traité afin de permettre une reprise après vérification.

## Essai manuel restant

1. Ouvrir http://127.0.0.1:3000/fr et se connecter à la maquette.
2. Ajouter un produit disponible au panier, renseigner Discord et accepter les conditions.
3. Choisir **Tester avec PayPal Sandbox**.
4. Approuver avec un compte acheteur **Personal Sandbox**, distinct du compte Business destinataire. Les comptes de test se trouvent dans [PayPal Developer → Sandbox Accounts](https://developer.paypal.com/sandbox-testing/accounts).
5. Au retour, vérifier la confirmation, une clé par unité et le téléchargement.
6. Recharger la page et ouvrir Mes commandes : la même commande et les mêmes clés doivent rester accessibles.
7. Dans Administration → Paiements PayPal, vérifier le montant, le compte d'origine et l'état terminé. Pour tester les emails, le compte client de la maquette doit correspondre au destinataire actuellement autorisé par Resend ; aucun autre destinataire n'est substitué automatiquement.

Mise à jour après livraison : l'utilisateur a confirmé l'approbation du paiement Sandbox et la réception des clés au retour. Ne communiquer aucun mot de passe, clé API ou code d'activation dans le chat. Si une tentative existe déjà, la reprendre depuis Mes commandes avant d'en créer une autre.

## Reproduire les vérifications

```bash
npm test
npm run test:db
npm run typecheck
npm run build
npm run test:e2e
npm run db:status
```

Le serveur de développement reste sur le port 3000. Le serveur navigateur de test utilise le port 3100 et s'arrête après les tests. Le suivi local des paiements nécessite `npm run paypal:reconcile -- --watch`.

La validation automatisée et la validation manuelle PayPal sont terminées. La phase suivante est la **phase 11 : préparation du déploiement Vercel/Neon**. Le stockage partagé des images, la configuration des tâches de fond et du webhook HTTPS, les sauvegardes et les secrets de production devront être traités avant mise en ligne. Aucun déploiement ni paiement Live n'est activé par cette phase.
