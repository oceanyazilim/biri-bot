import { ChannelType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { ALL_COMMANDS } from '../src/commands';
import { TempVoiceService } from '../src/modules/tempVoice/TempVoiceService';
import { createSilentLogger } from '../src/utils/logger';
import { createGuardHarness } from './fakes/guardHarness';

const defaults = { emptyDeleteDelaySec: 10, ownerGraceSec: 30, maxRoomsPerMember: 1, defaultUserLimit: 0 };

async function autoSetupHarness() {
  const h = await createGuardHarness({ enabled: false });
  const voice = new TempVoiceService(h.repos.tempVoice, h.selfActions, createSilentLogger(), { creationConcurrency: 3 });
  /** The same two steps /auto-setup performs. */
  const run = async () => {
    const voiceResult = await voice.setup(h.discordGuild, defaults);
    const guardResult = await h.guard.setup(h.discordGuild, h.guild.ownerId);
    return { voiceResult, guardResult };
  };
  return { ...h, voice, run };
}

const names = (h: Awaited<ReturnType<typeof autoSetupHarness>>) => [...h.guild.channels.cache.values()].map((c) => c.name).sort();

describe('/auto-setup', () => {
  it('is registered as a slash command', () => {
    expect(ALL_COMMANDS.map((c) => c.data.name)).toContain('auto-setup');
  });

  it('creates the voice category, creator channel, log structure and enables Guard', async () => {
    const h = await autoSetupHarness();
    const { voiceResult, guardResult } = await h.run();

    expect(voiceResult).toMatchObject({ createdCategory: true, createdCreator: true });
    const creator = h.guild.channels.cache.get(voiceResult.config.creatorChannelId)!;
    expect(creator).toMatchObject({ name: '➕・Oda Oluştur', type: ChannelType.GuildVoice, parentId: voiceResult.config.categoryId });
    expect(h.guild.channels.cache.get(voiceResult.config.categoryId)?.name).toBe('🔊 BİRİ SES ODALARI');

    expect(guardResult.logs.failed).toHaveLength(0);
    expect(guardResult.logs.created).toHaveLength(9); // category + 8 channels
    expect(names(h)).toEqual(
      expect.arrayContaining(['🛡️ BİRİ・GÜVENLİK', '🚨・biri-guard-log', '🔊・biri-ses-log', '⚙️・biri-sistem-log']),
    );
    expect(await h.config.get(h.guild.id)).toMatchObject({ enabled: true, mode: 'ACTIVE' });
  });

  it('is idempotent: running it again creates nothing new', async () => {
    const h = await autoSetupHarness();
    await h.run();
    const before = names(h);
    const createCalls = h.guild.channels.create.mock.calls.length;

    const second = await h.run();
    expect(second.voiceResult).toMatchObject({ createdCategory: false, createdCreator: false });
    expect(second.guardResult.logs.created).toHaveLength(0);
    expect(names(h)).toEqual(before);
    expect(h.guild.channels.create.mock.calls.length).toBe(createCalls);
  });

  it('reuses channels after a restart (fresh service instances)', async () => {
    const h = await autoSetupHarness();
    await h.run();
    const restartedVoice = new TempVoiceService(h.repos.tempVoice, h.selfActions, createSilentLogger(), { creationConcurrency: 3 });
    const result = await restartedVoice.setup(h.discordGuild, defaults);
    expect(result).toMatchObject({ createdCategory: false, createdCreator: false });
  });
});
