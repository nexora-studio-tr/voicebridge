import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  REST,
  Routes,
  MessageFlags,
  DiscordAPIError,
  type VoiceState,
} from 'discord.js';
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  type VoiceConnection,
} from '@discordjs/voice';
import prism from 'prism-media';
import { type DiscordConfig, type Member, Fault, check } from '../core/contracts.js';
import { Rooms, type Room } from '../core/rooms.js';
import { Store } from '../core/store.js';
import { wav } from '../core/audio.js';

export interface Gateway {
  ready(): boolean;
  member(guild: string, user: string, fresh?: boolean): Promise<Member | null>;
  allowed(room: Room, user: string): boolean;
  start(): Promise<void>;
  stop(): void;
  status(): { connected: boolean; configured: boolean; error: string | null };
}
export const command = {
  name: 'voicebridge',
  description: 'Personal captions and translated speech',
  description_localizations: { tr: 'Kişisel altyazı ve sesli çeviri' },
  options: [
    {
      type: 1,
      name: 'start',
      name_localizations: { tr: 'baslat' },
      description: 'Start in your voice room',
    },
    {
      type: 1,
      name: 'stop',
      name_localizations: { tr: 'durdur' },
      description: 'Stop the current voice session',
    },
    { type: 1, name: 'panel', description: 'Open your private listening panel' },
    {
      type: 1,
      name: 'consent',
      name_localizations: { tr: 'onay' },
      description: 'Set your own speech processing consent',
      options: [
        {
          type: 5,
          name: 'local',
          name_localizations: { tr: 'yerel' },
          description: 'Allow local processing',
          required: true,
        },
        {
          type: 5,
          name: 'cloud',
          name_localizations: { tr: 'bulut' },
          description: 'Allow cloud processing',
          required: true,
        },
        {
          type: 3,
          name: 'language',
          name_localizations: { tr: 'dil' },
          description: 'Your spoken language',
          required: true,
          choices: [
            { name: 'Türkçe', value: 'tr' },
            { name: 'English', value: 'en' },
          ],
        },
      ],
    },
  ],
};

export class DiscordBridge implements Gateway {
  private client: Client | null = null;
  private snapshots = new Map<string, { member: Member; expires: number }>();
  private connections = new Map<string, VoiceConnection>();
  private captureStops = new Map<string, () => void>();
  private refresh: ReturnType<typeof setInterval> | null = null;
  private lastError: string | null = null;
  rooms: Rooms | null = null;
  constructor(
    private store: Store,
    private origin: string,
  ) {}
  ready() {
    return this.client?.isReady() ?? false;
  }
  status() {
    return {
      connected: this.ready(),
      configured: !!this.store.get('discord'),
      error: this.lastError,
    };
  }
  async start() {
    const config = this.store.get<DiscordConfig>('discord');
    check(config, 'DISCORD_NOT_CONFIGURED', 409);
    this.stop();
    this.lastError = null;
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
      rest: { timeout: 10_000, retries: 0 },
    });
    this.client = client;
    client.on(Events.Error, () => {
      this.lastError = 'DISCORD_CONNECTION_ERROR';
    });
    client.on(Events.ShardDisconnect, () => {
      this.snapshots.clear();
      this.rooms?.stopAll('connection_lost');
      this.destroyConnections();
    });
    client.on(Events.VoiceStateUpdate, (before, after) => this.voiceUpdate(before, after));
    client.on(Events.GuildDelete, (g) => {
      for (const r of this.rooms?.rooms.values() ?? []) if (r.guildId === g.id) this.end(r);
    });
    client.on(Events.ChannelDelete, (c) => {
      for (const r of this.rooms?.rooms.values() ?? []) if (r.channelId === c.id) this.end(r);
    });
    client.on(Events.InteractionCreate, async (interaction) => {
      if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== 'voicebridge' ||
        !interaction.guildId
      )
        return;
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        check(config.guilds.includes(interaction.guildId), 'GUILD_NOT_ALLOWED', 403);
        const member = await this.member(interaction.guildId, interaction.user.id, true);
        check(member, 'GUILD_MEMBERSHIP_REQUIRED', 403);
        const sub = interaction.options.getSubcommand();
        if (sub === 'start') {
          check(member.admin, 'ADMIN_REQUIRED', 403);
          check(member.channelId, 'VOICE_MEMBERSHIP_REQUIRED', 403);
          await this.open(member);
        } else if (sub === 'stop') {
          check(member.admin, 'ADMIN_REQUIRED', 403);
          const room = [...this.rooms!.rooms.values()].find(
            (r) => r.guildId === interaction.guildId,
          );
          if (room) this.end(room);
        } else if (sub === 'consent') {
          const room = [...this.rooms!.rooms.values()].find(
            (r) => r.guildId === interaction.guildId && r.channelId === member.channelId,
          );
          check(room, 'ROOM_NOT_FOUND', 404);
          this.rooms!.addSpeaker(room, member.id, member.name);
          this.rooms!.consent(room, member.id, {
            local: interaction.options.getBoolean('local', true),
            cloud: interaction.options.getBoolean('cloud', true),
            language: interaction.options.getString('language', true),
          });
        }
        await interaction.editReply({
          content:
            sub === 'stop'
              ? 'VoiceBridge stopped. / VoiceBridge durduruldu.'
              : `VoiceBridge panel: ${this.origin}/\nYour speech is processed only after consent. / Sesiniz yalnızca onayınızdan sonra işlenir.`,
        });
      } catch (e) {
        if (interaction.deferred || interaction.replied)
          await interaction
            .editReply({
              content: 'VoiceBridge: ' + (e instanceof Fault ? e.code : 'DISCORD_ACTION_FAILED'),
            })
            .catch(() => {});
      }
    });
    let startupStage = 'gateway_login';
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Fault('DISCORD_LOGIN_TIMEOUT', 504)), 20_000);
        client.once(Events.ClientReady, () => {
          clearTimeout(timeout);
          resolve();
        });
        client.login(config.token).catch(() => {
          clearTimeout(timeout);
          reject(new Fault('DISCORD_TOKEN_REJECTED', 401));
        });
      });
      check(client.application?.id === config.applicationId, 'BOT_APP_MISMATCH', 409);
      startupStage = 'guild_commands';
      const rest = new REST({ version: '10', timeout: 10_000, retries: 0 }).setToken(config.token);
      for (const guild of config.guilds)
        await rest.put(Routes.applicationGuildCommands(config.applicationId, guild), {
          body: [command],
        });
      this.refresh = setInterval(() => void this.refreshMembers(), 4000);
      this.refresh.unref();
    } catch (e) {
      const apiCode = e instanceof DiscordAPIError && typeof e.code === 'number' ? e.code : null;
      console.warn(
        JSON.stringify({
          event: 'discord_start_failed',
          stage: startupStage,
          kind:
            e instanceof DiscordAPIError
              ? 'DiscordAPIError'
              : e instanceof Fault
                ? 'Fault'
                : e instanceof TypeError
                  ? 'TypeError'
                  : 'Error',
          status: e instanceof DiscordAPIError ? e.status : null,
          code: apiCode,
        }),
      );
      this.lastError =
        e instanceof Fault
          ? e.code
          : apiCode === 50001
            ? 'DISCORD_GUILD_ACCESS_REQUIRED'
            : apiCode === 50013
              ? 'DISCORD_GUILD_PERMISSION_REQUIRED'
              : apiCode === 10004
                ? 'DISCORD_GUILD_NOT_FOUND'
                : 'DISCORD_START_FAILED';
      this.stop();
      throw new Fault(this.lastError, 503);
    }
  }
  stop() {
    if (this.refresh) clearInterval(this.refresh);
    this.refresh = null;
    this.rooms?.stopAll('connection_lost');
    this.destroyConnections();
    this.client?.destroy();
    this.client = null;
    this.snapshots.clear();
  }
  private destroyConnections() {
    for (const stop of this.captureStops.values()) stop();
    this.captureStops.clear();
    for (const connection of this.connections.values()) connection.destroy();
    this.connections.clear();
  }
  async member(guildId: string, userId: string, fresh = false): Promise<Member | null> {
    if (!this.ready()) return null;
    const config = this.store.get<DiscordConfig>('discord');
    if (!config?.guilds.includes(guildId)) return null;
    const key = guildId + ':' + userId,
      old = this.snapshots.get(key);
    if (!fresh && old && old.expires > Date.now()) return old.member;
    try {
      const guild = this.client!.guilds.cache.get(guildId);
      if (!guild) return null;
      const m = await guild.members.fetch({ user: userId, force: true });
      if (m.pending || m.user.bot) return null;
      const voice = guild.voiceStates.cache.get(userId),
        channel = voice?.channel;
      const canHear =
        channel?.type === ChannelType.GuildVoice &&
        !voice?.serverDeaf &&
        !!channel
          .permissionsFor(m)
          ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]);
      const member: Member = {
        id: userId,
        name: m.displayName,
        guildId,
        guildName: guild.name,
        channelId: canHear ? channel!.id : null,
        channelName: canHear ? channel!.name : null,
        admin: m.id === guild.ownerId || m.permissions.has(PermissionFlagsBits.ManageGuild),
      };
      this.snapshots.set(key, { member, expires: Date.now() + 10_000 });
      return member;
    } catch {
      this.snapshots.delete(key);
      return null;
    }
  }
  allowed(room: Room, userId: string) {
    const snapshot = this.snapshots.get(room.guildId + ':' + userId);
    return (
      this.ready() &&
      !!snapshot &&
      snapshot.expires > Date.now() &&
      snapshot.member.channelId === room.channelId &&
      this.client?.guilds.cache.get(room.guildId)?.voiceStates.cache.get(userId)?.channelId ===
        room.channelId
    );
  }
  private async refreshMembers() {
    for (const room of this.rooms?.rooms.values() ?? []) {
      for (const id of new Set([...room.listeners.keys(), ...room.speakers.keys()])) {
        const member = await this.member(room.guildId, id, true);
        if (!member || member.channelId !== room.channelId) {
          this.rooms?.leave(room, id);
          this.captureStops.get(room.guildId + ':' + id)?.();
        }
      }
    }
  }
  private voiceUpdate(before: VoiceState, after: VoiceState) {
    this.snapshots.delete(after.guild.id + ':' + after.id);
    for (const room of this.rooms?.rooms.values() ?? []) {
      if (room.guildId !== after.guild.id) continue;
      if (after.id === this.client?.user?.id) {
        if (before.channelId === room.channelId && after.channelId !== room.channelId)
          this.end(room);
        continue;
      }
      if (
        before.channelId === room.channelId &&
        (after.channelId !== room.channelId || after.serverDeaf)
      ) {
        this.rooms?.leave(room, after.id);
        this.captureStops.get(room.guildId + ':' + after.id)?.();
      } else if (after.channelId === room.channelId && after.member && !after.member.user.bot) {
        this.rooms?.addSpeaker(room, after.id, after.member.displayName);
        void this.member(room.guildId, after.id, true);
      }
      const channel = after.guild.channels.cache.get(room.channelId);
      if (channel?.isVoiceBased() && !channel.members.some((m) => !m.user.bot)) this.end(room);
    }
  }
  async open(member: Member) {
    check(member.admin && member.channelId, 'ADMIN_REQUIRED', 403);
    check(this.rooms && this.client?.isReady(), 'DISCORD_OFFLINE', 503);
    const guild = this.client.guilds.cache.get(member.guildId),
      channel = guild?.channels.cache.get(member.channelId);
    check(guild && channel?.type === ChannelType.GuildVoice, 'VOICE_MEMBERSHIP_REQUIRED', 403);
    const me = guild.members.me;
    check(
      me &&
        channel
          .permissionsFor(me)
          ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]),
      'BOT_VOICE_PERMISSIONS',
      403,
    );
    const room = this.rooms.create(guild.id, guild.name, channel.id, channel.name, member.id);
    if (this.connections.has(guild.id)) return room;
    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
      });
      this.connections.set(guild.id, connection);
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      for (const m of channel.members.values())
        if (!m.user.bot) {
          this.rooms.addSpeaker(room, m.id, m.displayName);
          await this.member(guild.id, m.id, true);
        }
      connection.on(VoiceConnectionStatus.Disconnected, () => {
        if (room.active) this.end(room);
      });
      connection.receiver.speaking.on('start', (id) => this.capture(room, id, connection));
      return room;
    } catch {
      this.end(room);
      throw new Fault('VOICE_CONNECTION_FAILED', 503);
    }
  }
  interruptSpeaker(room: Room, id: string) {
    this.captureStops.get(room.guildId + ':' + id)?.();
  }
  private capture(room: Room, id: string, connection: VoiceConnection) {
    const speaker = room.speakers.get(id),
      key = room.guildId + ':' + id;
    if (!speaker?.consent.local || !this.allowed(room, id) || this.captureStops.has(key)) return;
    const epoch = speaker.epoch;
    const stream = connection.receiver.subscribe(id, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 450 },
    });
    const decoder = new prism.opus.Decoder({ rate: 16000, channels: 1, frameSize: 320 });
    let chunks: Buffer[] = [],
      size = 0,
      first = Date.now(),
      last = first,
      invalid = false,
      closed = false;
    const flush = () => {
      if (size && speaker.epoch === epoch && speaker.consent.local && this.allowed(room, id)) {
        const span = Math.max(0.02, (last - first) / 1000),
          seconds = size / 32000;
        this.rooms?.ingest(
          room,
          id,
          wav(Buffer.concat(chunks)),
          invalid || (span > 1 && seconds < span * 0.65),
        );
      }
      chunks = [];
      size = 0;
      first = Date.now();
      invalid = false;
    };
    const stop = () => {
      if (closed) return;
      closed = true;
      stream.destroy();
      decoder.destroy();
      chunks = [];
      size = 0;
      this.captureStops.delete(key);
      speaker.speaking = false;
    };
    this.captureStops.set(key, stop);
    speaker.speaking = true;
    decoder.on('data', (chunk: Buffer) => {
      if (
        closed ||
        !room.active ||
        speaker.epoch !== epoch ||
        !speaker.consent.local ||
        !this.allowed(room, id)
      ) {
        stop();
        return;
      }
      if (size + chunk.length > 16000 * 2 * 6) flush();
      if (!size) first = Date.now();
      last = Date.now();
      chunks.push(chunk);
      size += chunk.length;
    });
    decoder.on('error', () => {
      invalid = true;
      flush();
      stop();
    });
    stream.on('error', () => {
      invalid = true;
      flush();
      stop();
    });
    decoder.on('end', () => {
      flush();
      stop();
    });
    stream.pipe(decoder);
  }
  end(room: Room) {
    this.rooms?.stop(room);
    for (const [key, stop] of this.captureStops) if (key.startsWith(room.guildId + ':')) stop();
    const connection = this.connections.get(room.guildId);
    this.connections.delete(room.guildId);
    connection?.destroy();
  }
}
