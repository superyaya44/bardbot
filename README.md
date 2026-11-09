# 🎵 Bardbot

Bot Discord qui joue des playlists YouTube pendant les sessions de jeu de rôle (D&D) — pensé pour que le MJ prépare tout la veille et ne touche plus à rien pendant la partie.

## Le concept

- **En session (tout le monde)** : des commandes slash **créées sur mesure** depuis le dashboard (`/combat`, `/taverne`, …). Chaque commande lance une playlist, avec loop, shuffle et volume réglables. Zéro navigation de menus en plein jeu.
- **En préparation (MJ uniquement)** : un dashboard web pour créer les playlists, importer depuis YouTube, et générer les commandes slash dynamiques — synchronisées automatiquement avec Discord via l'API guild commands.

```
[Dashboard Web (React/Vite)] ←→ [API Node + Express + SQLite] ←→ [Bot discord.js]
                                        ↓
                              yt-dlp + FFmpeg → salon vocal
```

## Fonctionnalités

- 🎶 Lecture de playlists YouTube dans un salon vocal (yt-dlp + FFmpeg)
- ⚔️ Commandes slash dynamiques créées depuis le dashboard (nom, playlist cible, loop, shuffle, volume, rôles autorisés)
- 📋 Playlists : création manuelle ou import d'une playlist YouTube entière
- 🔐 Permissions par rôles Discord (superadmin / MJ / joueurs)
- 🌐 Dashboard React avec gestion live de la file d'attente
- ❤️ Health check (`GET /api/health`) pour systemd/Docker

## Stack

- **Bot & API** : Node.js, discord.js v14, @discordjs/voice, Express, better-sqlite3
- **Audio** : yt-dlp, FFmpeg
- **Dashboard** : React 18 + Vite

## Installation

### Prérequis

- Node.js ≥ 20, FFmpeg, yt-dlp (≥ 2025.05.22) installés
- Un bot Discord créé sur https://discord.com/developers/applications (token + ID de guild)

### Config

```bash
cp .env.example .env
# renseigner DISCORD_TOKEN, GUILD_ID, SUPERADMIN_ID
npm install
node src/index.js
```

Le dashboard est servi par la même API (port 3001 par défaut). **Ne l'exposez pas sur Internet public** : gardez-le sur loopback ou derrière un VPN (Tailscale).

### Dashboard

```bash
cd web && npm install && npm run build
```

Le build est servi par l'API. Pour le développement : `npm run dev` (Vite, proxy vers l'API).

### YouTube / IP datacenter

Si YouTube bloque les streams depuis votre serveur (403), faites tourner un fournisseur de tokens POT, par exemple le conteneur `brainicism/bgutil-ytdlp-pot-provider` — yt-dlp le détecte automatiquement (voir `.env.example`).

## Tests

```bash
node --test test/
```

## Licence

Usage perso — libre de vous en inspirer.
