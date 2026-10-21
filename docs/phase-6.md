# Phase 6 — Stocks et panier PostgreSQL

Le stock visible dans la boutique et le panier utilisent désormais PostgreSQL. L’administration permet d’ajouter une clé fictive, de consulter les clés disponibles ou attribuées et de désactiver une clé non attribuée. Aucun paiement, email ni déploiement n’a été ajouté.

## Essayer

```bash
npm run db:local:start
npm run db:migrate
npm run dev
```

- Stocks, avec un compte ADMIN : http://127.0.0.1:3000/fr/admin/stocks
- Boutique : http://127.0.0.1:3000/fr/boutique
- Panier : http://127.0.0.1:3000/fr/panier
- Tables : `npm run db:studio`, puis http://localhost:5555

Les produits, images et comptes déjà créés sont conservés. Les anciens stocks et paniers du stockage local ne sont plus utilisés : réajouter au besoin les produits d’un ancien panier de présentation. Les anciens aperçus de commandes restent lisibles dans le même navigateur.

## Stock et clés

La disponibilité est calculée à partir des clés `isDemo=true`, non désactivées et sans `KeyAssignment`. Aucun compteur de stock modifiable n’est enregistré. Ce calcul est commun aux cartes produit, fiches, panier et dashboard.

L’ajout accepte uniquement une clé fictive `DEMO-…`, normalisée en majuscules, entre 8 et 85 caractères. Chaque ajout chiffre la valeur en AES-256-GCM avec un nonce aléatoire et calcule son empreinte HMAC. L’unicité de cette empreinte interdit le doublon, même pour un autre produit. La valeur et son empreinte ne figurent pas dans les journaux d’audit.

La liste est paginée par 25 clés et masque leur valeur. Le bouton Afficher demande explicitement une déchiffrement autorisé côté serveur, avec réponse privée non mise en cache et événement `inventory.key.view`. La valeur reste seulement en mémoire dans le composant : elle est retirée au changement de produit, de page, à la mise en arrière-plan et périodiquement. Elle n’est jamais placée dans `localStorage`.

L’administration affiche l’état disponible, désactivé ou attribué, ainsi que la référence de la commande associée lorsqu’elle existe. Une clé attribuée ne peut être désactivée ni réattribuée ; le service verrouille les lignes concernées et la contrainte PostgreSQL déjà présente reste une seconde protection. Le détail des commandes en base sera connecté en phase 7.

Les modifications revérifient le rôle et l’activation de l’administrateur dans une transaction. Ajout, activation, désactivation et consultation sont journalisés. Les mutations et révélations contrôlent aussi l’origine, le JSON, la taille du corps et les limites persistantes de tentatives.

## Panier invité

Un invité dispose d’un panier en base identifié par un jeton aléatoire de 32 octets. Le navigateur conserve uniquement ce jeton dans le cookie `unlock-all.cart`, HttpOnly, SameSite=Lax, Secure avec HTTPS, pendant 30 jours. Seule son empreinte SHA-256 est stockée dans `Cart`. Le jeton n’est pas exposé à JavaScript ou aux réponses JSON.

Le panier invité expire après 30 jours ; ce n’est pas une réservation de stock. `npm run auth:cleanup` supprime aussi les paniers invités expirés et leurs lignes. Le panier d’un utilisateur connecté n’est pas soumis à cette expiration.

## Panier connecté et fusion

Le propriétaire est déduit de la session et du cookie, jamais d’un identifiant envoyé dans le corps de la requête. Le panier connecté est donc partagé entre les appareils utilisant le même compte et conservé après déconnexion.

À la connexion, le serveur additionne les quantités du panier invité et du panier connecté, les limite au stock disponible et à 1 000 unités par ligne, ignore les produits non publiés ou devenus indisponibles, puis supprime le panier invité dans la même transaction. Une fusion rejouée ou concurrente n’ajoute pas une seconde fois les mêmes articles. Le cookie invité est supprimé après fusion. Si une quantité a été ajustée, l’interface l’indique.

Chaque panier est limité à 100 produits distincts. Les quantités sont des entiers et les requêtes comportant un prix, un rôle ou un identifiant de propriétaire sont rejetées. Les noms, images, prix et totaux sont relus en base.

## Quantités et concurrence

Les ajouts sont additifs et sérialisés côté serveur. Une modification de quantité ou suppression comporte la `revision` du panier affiché : si un autre onglet a modifié le panier, la version ancienne reçoit 409, puis l’interface recharge le panier sans écraser le changement distant.

Les écritures verrouillent le propriétaire connecté, le panier et le produit concerné. Les mutations sont mises en file côté navigateur ; les boutons concernés affichent un état occupé. Les autres onglets sont avertis via BroadcastChannel. Le panier et le catalogue sont aussi actualisés au changement de page, au retour dans la fenêtre et toutes les 15 secondes lorsque la page est visible.

Une baisse de stock n’efface pas silencieusement le panier enregistré. Le panier devient invalide, le stock insuffisant est indiqué, et la prévisualisation est bloquée jusqu’à modification ou réapprovisionnement. Les erreurs réseau restent visibles avec une action Réessayer : aucun ajout n’est annoncé comme réussi sans réponse serveur.

## Avant la commande

`POST /api/cart/validate` relit le panier du compte, les produits publiés et leurs stocks. Il refuse un panier vide, un produit désactivé ou une quantité indisponible. Ajouter un produit au panier ou valider cet état ne réserve aucune clé et ne garantit pas sa disponibilité à un instant ultérieur.

La phase 7 n’est pas commencée : le bouton Simuler la commande conserve uniquement l’aperçu local antérieur. Après contrôle serveur, cet aperçu génère des libellés indépendants `DEMO-PREVIEW-…`, conserve le panier en base et ne lit, n’attribue ou ne consomme aucune `ActivationKey`. La confirmation explique cette limite. Les aperçus ne sont pas des lignes `Order` PostgreSQL et ne modifient pas les indicateurs du dashboard.

La création transactionnelle des commandes, le contrôle final des stocks, l’attribution atomique et le vidage du panier dans la même transaction restent en phase 7.

## Modèle et APIs

La cinquième migration ajoute à `Cart` un propriétaire invité optionnel, sa date d’expiration et une révision. Une contrainte SQL exige exactement un propriétaire : soit un compte, soit l’empreinte d’un jeton invité avec expiration. Les relations et contraintes de quantité des lignes sont conservées.

| Méthode    | Route                         | Accès                                    |
| ---------- | ----------------------------- | ---------------------------------------- |
| GET        | `/api/cart`                   | Panier identifié par session ou cookie   |
| POST       | `/api/cart`                   | Ajout ou modification du panier courant  |
| POST       | `/api/cart/merge`             | Compte connecté, fusion du cookie invité |
| POST       | `/api/cart/validate`          | Compte connecté                          |
| GET / POST | `/api/admin/keys`             | ADMIN                                    |
| PATCH      | `/api/admin/keys/[id]`        | ADMIN                                    |
| POST       | `/api/admin/keys/[id]/reveal` | ADMIN, consultation auditée              |

Toutes les réponses de panier et d’administration portent `Cache-Control: no-store`. Le catalogue public retourne uniquement le nombre de clés disponibles : ni valeur, ni ciphertext, ni empreinte de clé.

Limites de tentatives : 120 mutations de panier sur 15 minutes par compte ou réseau invité ; 60 créations de paniers invités par heure et réseau ; 30 fusions avec un cookie invité et 30 validations sur 15 minutes par compte ; 100 écritures et 60 consultations de clés sur 15 minutes par administrateur. Hors Vercel, les en-têtes de proxy non fiables ne déterminent pas le réseau.

## Vérification

```bash
npm run db:validate
npm run db:status
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e
```

Les tests PostgreSQL et navigateur utilisent des schémas isolés, supprimés ensuite. La suite navigateur utilise désormais aussi ses propres secrets de chiffrement pour ajouter et consulter des clés de test sans dépendre des secrets de l’application.

Les contrôles couvrent notamment les compteurs partagés, l’isolation des paniers, les champs injectés, les cookies HttpOnly, la fusion rejouée ou concurrente, les modifications avec une version ancienne, la protection des clés attribuées, le chiffrement et les consultations auditées, les changements de stock et les erreurs réseau.

Validation finale du 21 octobre 2026 : compilation et TypeScript réussis ; **73 tests réussis** (11 unitaires, 26 PostgreSQL, 36 navigateur). Les cinq migrations sont appliquées et la comparaison du modèle Prisma avec la base ne détecte aucune différence. Les 76 fichiers du bundle client ont été contrôlés pour les cinq secrets et chaînes de connexion configurés : aucune exposition détectée.

Le catalogue et le panier répondent sur le serveur de développement. Les 13 produits de la base applicative sont conservés, avec 146 clés disponibles et aucune attribution créée par les tests. Les captures [ordinateur](apercu-phase-6-panier.png) et [mobile](apercu-phase-6-panier-mobile.png), prises dans le schéma de test, ont été inspectées visuellement.
