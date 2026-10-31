# Fraude Scanner

Vérifie en quelques secondes si un SMS Mobile Money (T-Money, Moov Money) ressemble à une arnaque.
Projet réalisé pour le hackathon **Build with Gemma** — Hacktoberfest Hack Day Lomé × LBS CS Club (31 octobre 2026).

## Fonctionnalités

- **Scanner d'arnaques** : colle un SMS ou joins une capture d'écran, obtiens un verdict clair
  (vert / orange / rouge) avec les raisons et un conseil pratique.
- **Mode apprentissage** (`/apprendre`, `/resume`, `/plan`, `/quiz`, `/reponse`, `/stop`) :
  révise tes cours avec Gemma.
- **Historique** conservé localement et synchronisé entre appareils après connexion ;
  les signalements restent dans le navigateur.
- **Règles de prudence** : si Gemma ne répond pas ou doute, jamais de verdict « légitime » à tort.

## Installation

```bash
cp .env.example .env
# renseigne les clés Gemini et Supabase dans .env
php -S localhost:8000 -t public
```

Puis ouvre http://localhost:8000

## Déploiement sur Vercel

Le projet utilise PHP. Déploie-le avec le `Dockerfile` FrankenPHP à la racine
(Vercel Container), et garde le répertoire racine du projet comme **Root
Directory**. Vercel détecte le Dockerfile : aucun `vercel.json` n'est nécessaire.

Dans **Vercel → Project Settings → Environment Variables**, ajoute les variables
nécessaires et redéploie :

- `LLM_PROVIDER` = `google`
- `GEMINI_API_KEY` = ta clé Google AI Studio
- `GEMMA_MODEL` = `gemma-4-26b-a4b-it`
- `SUPABASE_URL` = URL de ton projet Supabase
- `SUPABASE_PUBLISHABLE_KEY` = clé publishable Supabase

N'ajoute jamais de clé Supabase `secret` ou `service_role`. Le fichier `.env`
local est ignoré par Git et n'est pas copié dans l'image Docker. Le mode
apprentissage utilise une session PHP locale, qui n'est pas garantie entre
instances Vercel ; l'historique du scanner, lui, est synchronisé dans Supabase.

Pour la synchronisation de l'historique, configure `SUPABASE_URL` et
`SUPABASE_PUBLISHABLE_KEY` dans `.env`, active l'authentification par e-mail,
et crée `public.scan_history` avec RLS et les politiques ci-dessous dans le SQL
Editor de Supabase :

```sql
alter table public.scan_history enable row level security;

drop policy if exists "Users can read their own scan history" on public.scan_history;
create policy "Users can read their own scan history"
  on public.scan_history for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own scan history" on public.scan_history;
create policy "Users can insert their own scan history"
  on public.scan_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own scan history" on public.scan_history;
create policy "Users can delete their own scan history"
  on public.scan_history for delete to authenticated
  using ((select auth.uid()) = user_id);
```

Le navigateur importe une fois l'historique local au premier compte connecté,
puis synchronise les 30 entrées les plus récentes. Supabase ne reçoit que le
verdict, la date et un extrait limité à 70 caractères. N'utilise jamais une clé
Supabase `secret` ou `service_role` dans l'application.

## Stack

PHP 8 (curl, fileinfo) · Gemma via API Google ou Groq · Bootstrap 5 · JavaScript

## Structure

```
public/          pages web + api/analyser.php
partials/        header.php / footer.php communs
src/             GeminiService.php, Scanner.php, Apprendre.php
data/            formats_officiels.json, signes_arnaque.json
.env             clé API (non versionnée)
```

## Avertissement

Le verdict est une **estimation du risque**, pas une garantie. En cas de doute,
vérifie toujours dans l'application officielle de ton opérateur.
