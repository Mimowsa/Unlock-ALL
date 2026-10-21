# Phase 4 — Authentification réelle

État livré en phase 4. Le catalogue, les indicateurs et les comptes administrés sont désormais connectés en [phase 5](phase-5.md).

L’inscription, la connexion, la déconnexion et le profil utilisent désormais PostgreSQL. Les raccourcis de connexion fictive ont été retirés. Le design et les parcours de la boutique sont conservés ; produits, panier, stocks et commandes restent locaux jusqu’aux phases suivantes.

## Choix technique

La version stable `next-auth` **4.24.15**, de la famille Auth.js, prend en charge Next.js 16 et React 19 dans ses dépendances déclarées. Elle est verrouillée dans le projet. La préversion v5 n’est pas utilisée.

Le fournisseur Credentials vérifie les mots de passe via nos services. Zod 4.6.7 valide les entrées. Argon2 0.45.1 produit des hashes Argon2id avec 64 Mio de mémoire, trois itérations et un parallélisme de 1. La politique accepte les phrases de passe de 15 à 128 caractères, espaces et Unicode compris, sans tronquer ou supprimer les espaces du mot de passe.

## Configuration locale

Les migrations de la phase 4 sont déjà appliquées sur la base locale du projet. Pour une nouvelle installation :

```bash
npm ci
npm run db:local:start
npm run db:migrate
npm run db:seed
npm run auth:configure
npm run dev
```

Ouvrir **http://127.0.0.1:3000/fr/inscription**. Créer un compte avec un pseudonyme, une adresse email et une phrase de passe. Le compte peut ensuite être observé dans Prisma Studio (`npm run db:studio`). L’application n’envoie aucun email de bienvenue à cette phase.

`auth:configure` ajoute les réglages manquants à `.env` sans remplacer les valeurs existantes. Le secret d’authentification est généré aléatoirement et reste distinct des secrets de chiffrement des clés. Le fichier reste privé, avec permissions `600`. Aucun secret n’est imprimé.

`NEXTAUTH_URL` désigne l’origine canonique, port inclus. Utiliser cette même adresse dans le navigateur : `localhost` et `127.0.0.1` sont des origines différentes pour les protections des formulaires. Redémarrer le serveur après un changement de configuration. Hors boucle locale, l’authentification nécessite HTTPS.

## Premier administrateur

```bash
npm run auth:admin
```

La commande demande l’adresse email, le pseudonyme et le mot de passe avec saisie masquée. Utiliser une nouvelle adresse ou l’adresse d’un profil initial fictif. Elle ne remplace pas un compte réel déjà existant. Aucun mot de passe n’est fourni dans les arguments de commande, affiché ou enregistré dans un fichier.

La création ou activation est transactionnelle et tracée dans `AuditLog`. Le profil initial `admin@example.com` reste inactif et sans mot de passe tant que l’opérateur ne le provisionne pas explicitement. Il n’existe aucun endpoint public permettant de créer un administrateur.

La gestion des rôles des comptes existants dans l’interface sera connectée en phase 5. Les deux profils présentés actuellement dans la gestion des utilisateurs restent fictifs ; les modifier ne change pas les droits des comptes PostgreSQL.

## Sessions et autorisations

Les cookies Auth.js sont HttpOnly et SameSite=Lax ; ils utilisent Secure sur l’origine HTTPS configurée. Leur contenu JWT est chiffré par Auth.js. Aucun JWT ni mot de passe n’est placé dans le stockage local du navigateur.

Chaque connexion crée en plus une ligne `Session` contenant l’empreinte d’un identifiant aléatoire de session. Le JWT contient cet identifiant, le compte et sa version de sécurité. Cet usage complète les JWT Credentials ; ce n’est pas la stratégie Auth.js d’authentification par session opaque avec adaptateur.

À chaque consultation de session ou accès protégé, le serveur vérifie :

- l’existence de la session en base et sa date d’expiration, fixée à huit heures après connexion ;
- l’identité du propriétaire ;
- l’état actif et le caractère réel du compte ;
- la version de sécurité actuelle ;
- le rôle actuel dans PostgreSQL, jamais une valeur envoyée par le navigateur.

La déconnexion supprime la session en base. Un cookie précédemment copié ne restaure pas cette session. Un changement de mot de passe, de rôle ou d’activation incrémente la version de sécurité au niveau PostgreSQL et invalide les anciens JWT. La réinitialisation supprime aussi toutes les sessions du compte.

Les pages de compte, de commande, de confirmation et d’administration sont protégées côté serveur. L’administration exige ADMIN ; un utilisateur standard est redirigé vers son compte. Les APIs vérifient elles-mêmes l’identité et renvoient 401 pour un accès non authentifié. Une redirection App Router peut être transmise dans une réponse diffusée en streaming : le statut HTTP de la page n’est pas à lui seul une décision d’autorisation.

Les données fictives de commande restent propres au navigateur et liées à l’identifiant du compte authentifié. Leur contrôle local ne remplace pas le contrôle serveur des commandes réelles qui sera ajouté en phase 7.

## Inscription et profil

`POST /api/auth/register` valide strictement email, pseudonyme, mot de passe et langue. L’email est normalisé en minuscules et reste unique. Le rôle USER et l’activation sont fixés côté serveur ; des champs supplémentaires comme `role` ou `active` sont rejetés.

`GET /api/account/profile` retourne uniquement les champs de présentation du compte authentifié. `PATCH` permet de modifier pseudonyme et Discord, sans accepter de rôle, d’activation ou d’adresse email. L’email de connexion reste en lecture seule ; un futur changement d’adresse devra prévoir une vérification adaptée. L’adresse n’est pas déclarée vérifiée lors de l’inscription.

Les mots de passe et hashes ne sont jamais retournés dans une session ou un profil. Les noms, emails et Discord des comptes authentifiés ne sont plus sérialisés dans `localStorage`. Les paniers locaux peuvent conserver un identifiant de compte comme clé de rattachement ; les commandes fictives persistées utilisent un email anonyme et ne conservent pas Discord.

## Limites de tentatives et formulaires

`AuthRateLimit` conserve des compteurs atomiques dans PostgreSQL, partagés entre instances serveur. Les identifiants de limitation sont des HMAC ; les emails et IP ne sont pas stockés en clair dans cette table.

| Opération                                 | Limite                        |
| ----------------------------------------- | ----------------------------- |
| Connexion par adresse                     | 6 tentatives / 15 minutes     |
| Connexion par réseau                      | 30 tentatives / 15 minutes    |
| Inscription par réseau                    | 5 tentatives / heure          |
| Demande de réinitialisation par adresse   | 3 demandes / heure            |
| Demande de réinitialisation par réseau    | 10 demandes / heure           |
| Validation de réinitialisation par réseau | 10 tentatives / 15 minutes    |
| Modification du profil                    | 30 modifications / 15 minutes |

Les tentatives incluent les connexions réussies pour éviter les courses entre vérification et incrémentation. Hors Vercel, les en-têtes de proxy fournis par un client ne sont pas considérés fiables : un compartiment réseau commun est utilisé, en plus de la limite par adresse. Un déploiement derrière un autre proxy nécessitera une configuration explicite de cette confiance.

Auth.js protège ses formulaires avec son mécanisme CSRF. Les mutations de l’application imposent aussi l’origine canonique, le JSON pour les APIs dédiées, des entrées validées et une taille de corps limitée à 8 Kio. Les réponses de compte et d’authentification ne sont pas mises en cache. Les erreurs restent génériques et les logs n’enregistrent pas les mots de passe, cookies ou jetons.

## Réinitialisation du mot de passe

Le parcours complet utilise un jeton aléatoire de 32 octets, dont seule l’empreinte SHA-256 est enregistrée dans `PasswordResetToken`. Le lien expire après 20 minutes. Son utilisation est atomique : deux requêtes concurrentes ne peuvent pas l’utiliser toutes les deux. Un nouveau lien invalide les anciens liens non utilisés du même compte.

Le service emails est prévu pour la phase 8. Pour tester sans envoyer de message :

1. Lancer `npm run dev` avec `APP_MODE=demo` et `AUTH_RESET_DELIVERY=local`.
2. Demander le lien sur « Mot de passe oublié » pour un compte réel actif.
3. Ouvrir `.local/password-reset/` sur la machine du développeur ; sur macOS : `open .local/password-reset`.
4. Ouvrir le fichier JSON privé et copier son champ `url` dans le navigateur.
5. Choisir et confirmer le nouveau mot de passe.

Les fichiers sont créés avec permissions `600` dans un dossier privé, jamais sous `public/`. Leur contenu reste un secret temporaire réservé à l’opérateur local. Ils ne sont ni exposés par une API ni inclus dans la réponse à la demande de lien. Le jeton est placé dans le fragment de l’URL, puis retiré de la barre d’adresse après lecture : il n’apparaît pas dans la requête GET ou ses logs. La politique de référent est `no-referrer`.

La réponse HTTP est identique pour un compte actif, inconnu, désactivé ou fictif. L’interface indique clairement que le lien éventuel est dans la boîte locale et qu’aucun email n’a été envoyé. La boîte locale est désactivée sous `NODE_ENV=production` et sur Vercel. Sans mécanisme d’envoi configuré, aucune création de jeton n’est effectuée et l’interface indique l’absence d’envoi.

Cette phase ne revendique donc aucun envoi Resend. Il sera ajouté avec les modèles bilingues et les reprises d’emails en phase 8.

## Dernier administrateur et maintenance

La quatrième migration ajoute `AuthSecurityState`, une ligne de synchronisation pour les modifications d’administrateurs. Le trigger PostgreSQL empêche de supprimer, désactiver ou rétrograder le dernier administrateur actif, y compris lors de modifications concurrentes. Les modifications de sécurité mettent à jour la version des sessions. Un simple contrôle d’affichage ne porte pas cette garantie.

```bash
npm run auth:cleanup
```

Cette commande supprime les sessions, jetons de réinitialisation et compteurs de limite expirés. En développement, elle supprime aussi les fichiers de boîte locale expirés. La planification d’un nettoyage régulier fera partie de la préparation d’hébergement en phase 10.

## Vérifications

```bash
npm run db:validate
npm run db:status
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e
```

Les tests SQL et navigateur créent leurs propres schémas temporaires. La suite navigateur démarre son serveur sur le port 3100 et crée uniquement des comptes de test dans ce schéma ; elle ne réutilise pas les comptes applicatifs ni le serveur de développement. Ces schémas sont supprimés à la fin.

Les tests couvrent notamment le rôle injecté à l’inscription, les origines interdites, la connexion erronée, les cookies HttpOnly, la révocation avec relecture d’un ancien cookie, le stockage du profil, la désactivation d’un compte, les limites persistantes, les jetons expirés ou rejoués, les réinitialisations concurrentes et la protection concurrente du dernier administrateur.

Vérification finale du 20 octobre 2026 : compilation et TypeScript réussis ; 11 tests unitaires, 16 tests PostgreSQL et 20 tests navigateur réussis (47 au total). Les quatre migrations sont à jour et `npm audit --omit=dev` ne signale aucune vulnérabilité. La base applicative conserve ses 12 produits, 2 profils fictifs et 146 clés disponibles, sans attribution créée par les tests.

## Suite

Phase 5 après validation : connecter les produits et les écrans d’administration à la base. Les stocks et les commandes serveur suivront en phases 6 et 7. Aucun paiement ni déploiement n’a été ajouté.

## Références

- [Initialisation App Router de NextAuth.js](https://next-auth.js.org/configuration/initialization)
- [Fournisseur Credentials et sessions JWT](https://next-auth.js.org/providers/credentials)
- [Authentification dans Next.js](https://nextjs.org/docs/app/guides/authentication)
- [OWASP : authentification](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP : réinitialisation du mot de passe](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [En-têtes de requête Vercel](https://vercel.com/docs/headers/request-headers)
