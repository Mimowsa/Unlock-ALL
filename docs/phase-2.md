# Revue de la phase 2

## Direction visuelle

Fond noir bleuté, surfaces anthracite, accent violet et visuels vectoriels originaux. Header compact, hero illustré, cartes produit, parcours en quatre étapes, FAQ dépliable et support. Navigation mobile, focus visible, lien d’évitement, formulaires étiquetés et animations réduites selon les préférences système.

## Pages à valider

Accueil, boutique, produit, panier, connexion, inscription, récupération de mot de passe (aperçu sans envoi), compte, commandes, détail, confirmation, support, mentions provisoires, conditions et confidentialité. Administration : aperçu, produits, clés, commandes, détail et utilisateurs.

## Opérations de présentation

- Filtrer/rechercher/trier le catalogue, changer de plateforme.
- Ajouter plusieurs produits, modifier les quantités, retirer des lignes.
- Ouvrir un profil fictif et fusionner son panier invité.
- Saisir Discord, vérifier le récapitulatif, simuler une commande.
- Afficher/copier les clés et télécharger le document inoffensif.
- Retrouver les commandes après rechargement du navigateur.
- Créer/modifier/désactiver un produit ; sélectionner son illustration et son chemin de téléchargement local.
- Ajouter une clé fictive unique, désactiver une clé non attribuée, retrouver la commande d’une clé livrée.
- Rechercher commandes et utilisateurs ; modifier les rôles et l’activation avec confirmation et protection du dernier administrateur actif.
- Réinitialiser les données locales avec confirmation.

## Validation attendue

Valider le design, les libellés FR/EN et l’organisation des parcours avant de commencer la base de données. Les garanties serveur, la concurrence entre acheteurs, les emails et les sessions sécurisées appartiennent aux phases suivantes et ne sont pas revendiqués par ce prototype.

## Vérifications effectuées le 20 octobre 2026

- Build de production `npm run build` : réussi.
- Vérification TypeScript : réussie.
- Tests du moteur local : 7 réussis.
- Tests Playwright sur le build de production : 10 réussis.
- Audit npm des dépendances de production : aucune vulnérabilité signalée.
- Contrôle visuel de l’accueil sur ordinateur et mobile ; absence de débordement global aux largeurs prévues. Les tableaux administratifs conservent leur propre défilement horizontal sur petit écran.

Captures de revue : [accueil](apercu-accueil.png), [mobile](apercu-mobile.png), [administration mobile](apercu-admin-mobile.png).

Ces contrôles portent sur la démonstration locale. Ils ne valident pas les garanties serveur prévues dans les phases suivantes.
