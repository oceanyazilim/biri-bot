import type { VoiceState } from 'discord.js';
import { RoomManager } from '../../src/modules/tempVoice/RoomManager';
import { TempVoiceService } from '../../src/modules/tempVoice/TempVoiceService';
import { SelfActionRegistry } from '../../src/services/SelfActionRegistry';
import { createSilentLogger } from '../../src/utils/logger';
import { asDiscord, FakeGuild, type FakeMember, type FakeVoiceChannel } from './discord';
import { createMemoryRepositories } from './memoryRepositories';

export interface VoiceHarnessOptions {
  emptyDeleteDelaySec?: number;
  ownerGraceSec?: number;
  maxRoomsPerMember?: number;
  guild?: FakeGuild;
  repos?: ReturnType<typeof createMemoryRepositories>;
}

export async function createVoiceHarness(options: VoiceHarnessOptions = {}) {
  const repos = options.repos ?? createMemoryRepositories();
  const guild = options.guild ?? new FakeGuild();
  const category = guild.addCategory('🔊 BİRİ SES ODALARI');
  const creator = guild.addVoiceChannel('➕・Oda Oluştur', category.id);
  await repos.tempVoice.upsertConfig(guild.id, {
    categoryId: category.id,
    creatorChannelId: creator.id,
    emptyDeleteDelaySec: options.emptyDeleteDelaySec ?? 5,
    ownerGraceSec: options.ownerGraceSec ?? 10,
    maxRoomsPerMember: options.maxRoomsPerMember ?? 1,
    defaultUserLimit: 0,
  });
  const selfActions = new SelfActionRegistry();
  const logger = createSilentLogger();
  const service = new TempVoiceService(repos.tempVoice, selfActions, logger, { creationConcurrency: 3 });
  const rooms = new RoomManager(service, repos.tempVoice, logger);

  /** Moves a member and delivers the voiceStateUpdate like the gateway would. */
  const move = async (member: FakeMember, channelId: string | null) => {
    const { oldState, newState } = guild.moveMember(member, channelId);
    await service.handleVoiceStateUpdate(asDiscord<VoiceState>(oldState), asDiscord<VoiceState>(newState));
  };

  /** Joins the creator channel and returns the created room channel. */
  const createRoom = async (member: FakeMember): Promise<FakeVoiceChannel> => {
    await move(member, creator.id);
    const channel = member.voice.channel;
    if (!channel || channel.id === creator.id) throw new Error('oda oluşturulmadı');
    return channel;
  };

  return { repos, guild, category, creator, selfActions, service, rooms, move, createRoom, logger };
}
