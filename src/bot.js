import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } from 'discord.js';
import db, {
  listPlaylists, getPlaylistByName, listTracks,
  listCommands, getCommand,
} from './db.js';
import { getSource } from './downloader.js';

const GUILD_ID = process.env.GUILD_ID;
const SUPERADMIN_ID = process.env.SUPERADMIN_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// ---------- Lecture audio (player maison via @discordjs/voice) ----------
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  NoSubscriberBehavior, AudioPlayerStatus, entersState, VoiceConnectionStatus,
  StreamType,
} from '@discordjs/voice';
import { spawn } from 'node:child_process';

const players = new Map(); // guildId -> { player, queue, now, channel, textChannel, loop, shuffle, volume, playlistId }

function getPlayerCtx(guild) {
  let ctx = players.get(guild.id);
  if (!ctx) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    ctx = { player, queue: [], tracks: [], now: null, channel: null, textChannel: null, loop: 1, shuffle: 0, volume: 50 };
    players.set(guild.id, ctx);
    player.on(AudioPlayerStatus.Idle, () => setTimeout(() => playNext(guild.id), 200));
    player.on('error', (e) => {
      console.error('player error:', e.message);
      setTimeout(() => playNext(guild.id), 200);
    });
  }
  return ctx;
}

// Que rejouer quand la file est vide ?
//   loop 0 = on s'arrête · 1 = on répète le morceau courant · 2 = on rejoue toute la playlist
// Retourne false s'il n'y a plus rien à jouer.
export function refillQueue(ctx) {
  if (ctx.queue.length > 0) return true;
  if (ctx.loop === 2 && ctx.tracks?.length) {
    ctx.queue = ctx.tracks.map((t) => ({ ...t })); // copie : la file est consommée par splice
    return true;
  }
  if (ctx.loop === 1 && ctx.now) {
    ctx.queue.push(ctx.now);
    return true;
  }
  return false;
}

async function playNext(guildId) {
  const ctx = players.get(guildId);
  if (!ctx) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  if (!refillQueue(ctx)) { ctx.now = null; return; }

  const idx = ctx.shuffle && ctx.queue.length > 1
    ? Math.floor(Math.random() * ctx.queue.length) : 0;
  const track = ctx.queue.splice(idx, 1)[0];

  try {
    // Fichier local en priorité (fiable en session), fallback stream YouTube
    const { src } = await getSource(track);
    // ffmpeg: input -> PCM avec volume. Flags -reconnect uniquement pour HTTP.
    const ffmpegArgs = src.startsWith('http')
      ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', src,
         '-af', `volume=${ctx.volume / 100}`,
         '-ac', '2', '-ar', '48000', '-f', 's16le', '-loglevel', 'error', 'pipe:1']
      : ['-i', src,
         '-af', `volume=${ctx.volume / 100}`,
         '-ac', '2', '-ar', '48000', '-f', 's16le', '-loglevel', 'error', 'pipe:1'];
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    // stderr capturé : sans ça, un crash ffmpeg est indiagnosticable (exit 152
    // opaque constaté en prod). On log la vraie cause au moment de l'échec.
    let ffErr = '';
    ffmpeg.stderr.on('data', (d) => { if (ffErr.length < 2000) ffErr += d; });
    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw, // PCM s16le 48kHz — sinon la lib le décode comme opus → silence
    });
    ffmpeg.on('exit', (code) => {
      if (code !== 0) {
        // EPIPE/reset au skip = benign : le player détruit la resource courante
        // quand on change de morceau, ffmpeg apprend la fermeture du pipe en
        // pleine écriture. Pas un crash — log discret pour ne pas noyer les vrais.
        const benign = /Connection reset by peer|Broken pipe/.test(ffErr);
        const line = `ffmpeg exit ${code}${benign ? ' (skip/fin de resource)' : ''} sur ${track.title}${!benign && ffErr.trim() ? `\n  stderr: ${ffErr.trim().split('\n').slice(-4).join(' | ')}` : ''}`;
        benign ? console.log(line) : console.error(line);
      }
    });
    ctx.player.play(resource);
    ctx.now = track;
    if (ctx.textChannel) {
      const embed = new EmbedBuilder()
        .setTitle('♪ ' + track.title)
        .setColor(0xd4a24e)
        .setFooter({ text: `${ctx.queue.length} morceau(x) en file · loop ${ctx.loop === 2 ? 'queue' : ctx.loop === 1 ? 'track' : 'off'} · vol ${ctx.volume}%` });
      ctx.textChannel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (e) {
    console.error('playNext fail:', e.message);
    if (ctx.textChannel) ctx.textChannel.send(`⚠️ Impossible de lire **${track.title}** — morceau suivant.`).catch(() => {});
    // Le morceau n'est pas fautif a priori (échec de résolution source) : on le
    // remet en FIN de file plutôt que de l'éjecter — max 2 retries, sinon une
    // source réellement morte bouclerait à l'infini et spammerait le salon.
    track._retries = (track._retries || 0) + 1;
    if (track._retries <= 2) ctx.queue.push(track);
    setTimeout(() => playNext(guildId), 200);
  }
}

export async function launchPlaylist(interaction, playlistId, { loop = 1, shuffle = false, volume = 50 }) {
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) {
    return { ok: false, msg: 'Tu dois être dans un salon vocal pour lancer la musique !' };
  }
  const tracks = listTracks(playlistId);
  if (!tracks.length) return { ok: false, msg: 'Cette playlist est vide.' };

  const ctx = getPlayerCtx(interaction.guild);
  ctx.queue = tracks.map((t) => ({ id: t.id, title: t.title, url: t.url, file_path: t.file_path }));
  ctx.tracks = ctx.queue.map((t) => ({ ...t })); // référence pour le loop queue
  ctx.playlistId = playlistId; // pour la sync live (ajouts/suppressions en cours de lecture)
  ctx.loop = loop;
  ctx.shuffle = shuffle ? 1 : 0;
  ctx.volume = volume;
  ctx.textChannel = interaction.channel;
  ctx.now = null;

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false, // sinon icône "sourdine" sur le bot dans le vocal
  });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  } catch {
    return { ok: false, msg: 'Impossible de rejoindre le salon vocal (timeout).' };
  }
  connection.subscribe(ctx.player);
  ctx.connection = connection;
  playNext(interaction.guild.id);
  return { ok: true, msg: null };
}

// Sync live : la playlist en cours de lecture sur un serveur doit refléter la
// DB (ajout d'un morceau depuis le dashboard en pleine session = pris en compte
// sans kick/relance du bot). On fusionne : les tracks inédits sont ajoutés en
// fin de file, ceux qui ne sont plus dans la playlist sont retirés, l'ordre
// existant est conservé. Appelé par l'API après chaque modif de playlist.
export function syncPlayingQueue(playlistId) {
  let touched = 0;
  for (const ctx of players.values()) {
    if (ctx.playlistId !== playlistId) continue;
    const tracks = listTracks(playlistId)
      .filter((t) => t.status === 'done') // ne mettre en file que du prêt à jouer
      .map((t) => ({ id: t.id, title: t.title, url: t.url, file_path: t.file_path }));
    const liveIds = new Set(tracks.map((t) => t.id));
    // retire de la file les tracks supprimés / non prêts
    ctx.queue = ctx.queue.filter((t) => liveIds.has(t.id));
    // ajoute en fin de file les nouveaux tracks pas encore programmés
    const queued = new Set([...ctx.queue.map((t) => t.id), ...(ctx.now ? [ctx.now.id] : [])]);
    for (const t of tracks) {
      if (!queued.has(t.id)) { ctx.queue.push(t); touched++; }
    }
    // met à jour la référence du loop queue (rejoue la playlist à l'identique)
    ctx.tracks = tracks.map((t) => ({ ...t }));
  }
  return touched;
}

// ---------- Rôles ----------
const ROLE_MJ = 'MJ';
const ROLE_SUPERADMIN = 'Superadmin';

function hasRole(member, roleName) {
  return member?.roles?.cache?.some((r) => r.name.toLowerCase() === roleName.toLowerCase());
}

export function isMJ(member) {
  return member && (hasRole(member, ROLE_MJ) || hasRole(member, ROLE_SUPERADMIN)
    || member.id === SUPERADMIN_ID);
}

export function isSuperadmin(member) {
  return member && (hasRole(member, ROLE_SUPERADMIN) || member.id === SUPERADMIN_ID);
}

// ---------- Sync des commandes dynamiques ----------
export async function syncGuildCommands() {
  const guilds = GUILD_ID
    ? [client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID)]
    : [...client.guilds.cache.values()];
  const cmds = listCommands();
  const builtin = [
    { name: 'stop', description: 'Stoppe la musique et vide la file' },
    { name: 'skip', description: 'Passe au morceau suivant' },
    { name: 'pause', description: 'Met la lecture en pause' },
    { name: 'resume', description: 'Reprend la lecture' },
    { name: 'leave', description: 'Déconnecte Bardbot du vocal' },
  ];
  const body = [
    ...builtin,
    ...cmds.map((c) => ({
      name: c.name,
      description: `${c.description} (playlist: ${c.playlist_name})`,
    })),
  ];
  for (const guild of guilds) {
    try {
      await guild.commands.set(body);
      console.log(`[commands] ${body.length} commande(s) synchronisée(s) sur ${guild.name}`);
    } catch (e) {
      console.error(`[commands] échec sync sur ${guild.name}:`, e.message);
    }
  }
}

// Re-sync quand la DB change (appelé par l'API dashboard)
client.syncGuildCommands = syncGuildCommands;

// ---------- Interactions ----------
client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) {
      // Commandes intégrées (contrôle lecture)
      if (['stop', 'skip', 'pause', 'resume', 'leave'].includes(i.commandName)) {
        const ctx = players.get(i.guildId);
        if (i.commandName === 'stop' || i.commandName === 'leave') {
          if (ctx) {
            ctx.player.stop(true);
            ctx.queue = []; ctx.now = null;
            try { ctx.connection?.destroy(); } catch {}
            players.delete(i.guildId);
          }
          return i.reply(i.commandName === 'stop'
            ? '⏹️ Musique stoppée, file vidée.'
            : '👋 Bardbot quitte le salon vocal.');
        }
        if (!ctx) return i.reply({ content: 'Rien en lecture actuellement.', ephemeral: true });
        if (i.commandName === 'skip') { ctx.player.stop(true); return i.reply('⏭️ Morceau suivant !'); }
        if (i.commandName === 'pause') { ctx.player.pause(); return i.reply('⏸️ Pause.'); }
        if (i.commandName === 'resume') { ctx.player.unpause(); return i.reply('▶️ Reprise de la lecture.'); }
      }

      const all = listCommands();
      const c = all.find((x) => x.name === i.commandName);
      if (!c) return;
      if (!i.inGuild()) return;

      // permission check
      const member = i.member;
      const allowed = JSON.parse(c.allowed_roles || '[]');
      const permitted = isMJ(member) || allowed.length === 0
        || allowed.some((rid) => member.roles?.cache?.has(rid));
      if (!permitted) {
        return i.reply({ content: '⛔ Réservé au MJ (ou aux rôles autorisés par le MJ).', ephemeral: true });
      }

      await i.deferReply();
      const res = await launchPlaylist(i, c.playlist_id, {
        loop: c.loop === 2 ? 2 : c.loop === 1 ? 1 : 0,
        shuffle: !!c.shuffle,
        volume: c.volume,
      });
      if (res.ok) {
        await i.editReply(` Bardbot en route ! Lancement de **${c.playlist_name}** ${c.loop ? '· loop ' + (c.loop === 2 ? 'queue' : 'track') : ''} ${c.shuffle ? '· shuffle' : ''} · vol ${c.volume}%`);
      } else {
        await i.editReply(`⚠️ ${res.msg}`);
      }
      return;
    }
  } catch (e) {
    console.error('interaction error:', e);
    if (i.isRepliable()) {
      const msg = '⚠️ Erreur interne — réessaie.';
      i.replied || i.deferred ? i.editReply(msg) : i.reply({ content: msg, ephemeral: true });
    }
  }
});

// ---------- Statut & login ----------
client.once('clientReady', () => {
  console.log(`[bot] Connecté: ${client.user.tag}`);
  client.user.setActivity('♫ vos playlists D&D', { type: 2 }); // LISTENING... on utilise Custom
  syncGuildCommands().catch(console.error);
});

client.login(process.env.DISCORD_TOKEN);
export default client;
