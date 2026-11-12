import { ChannelType, PermissionFlagsBits, type Guild } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { roomHubHandler } from '../src/components/roomHub';
import type { App } from '../src/core/App';
import { HUB_CHANNEL_NAME, LEGACY_HUB_CHANNEL_NAMES } from '../src/modules/tempVoice/panel';
import { TempVoiceService } from '../src/modules/tempVoice/TempVoiceService';
import type { ComponentInteraction } from '../src/types/command';
import { createSilentLogger } from '../src/utils/logger';
import { asDiscord, FakeTextChannel, type FakeMember } from './fakes/discord';
import { createVoiceHarness } from './fakes/harness';

const setupOptions = { emptyDeleteDelaySec: 5, ownerGraceSec: 10, maxRoomsPerMember: 1, defaultUserLimit: 0 };

async function hubHarness() {
  const h = await createVoiceHarness();
  const g = asDiscord<Guild>(h.guild);
  const result = await h.service.setup(g, setupOptions);
  const panel = h.guild.channels.cache.get(result.panel.channelId!) as FakeTextChannel;
  const app = asDiscord<App>({ rooms: h.rooms, tempVoice: h.service });

  /** Simulates a member picking a value from the panel's limit menu. */
  const pickLimit = async (member: FakeMember, value: string) => {
    const interaction = {
      member,
      guildId: h.guild.id,
      values: [value],
      deferred: false,
      replied: false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      update: vi.fn(async () => {
        interaction.replied = true;
      }),
      deferUpdate: vi.fn(async () => {
        interaction.deferred = true;
      }),
      reply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };
    await roomHubHandler.handle(asDiscord<ComponentInteraction>(interaction), app, ['limit']);
    return { interaction, payload: JSON.stringify(interaction.followUp.mock.calls) };
  };

  /** Simulates a member clicking a control panel button. */
  const click = async (member: FakeMember, action: string) => {
    const interaction = {
      member,
      deferred: false,
      replied: false,
      isButton: () => true,
      deferReply: vi.fn(async () => {
        interaction.deferred = true;
      }),
      reply: vi.fn(async () => {
        interaction.replied = true;
      }),
      editReply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
      showModal: vi.fn(async () => undefined),
    };
    await roomHubHandler.handle(asDiscord<ComponentInteraction>(interaction), app, [action]);
    const payload = JSON.stringify([...interaction.reply.mock.calls, ...interaction.editReply.mock.calls]);
    return { interaction, payload };
  };
  return { ...h, g, result, panel, click, pickLimit };
}

describe('control panel channel', () => {
  it('is created in the temp voice category with one panel message', async () => {
    const h = await hubHarness();
    expect(h.result.panel).toMatchObject({ created: true, error: null });
    expect(h.panel).toMatchObject({ name: HUB_CHANNEL_NAME, type: ChannelType.GuildText, parentId: h.category.id });
    expect(h.panel.sent).toHaveLength(1);
    const payload = JSON.stringify(h.panel.sent[0]!.payload);
    expect(h.panel.name).toBe('🎛️・biri-yönetim');
    expect(payload).toContain('Ses Odası Yönetimi');
    expect(payload).toContain('biri:hub:limit');
    for (const action of ['lock', 'unlock', 'hide', 'show', 'kick', 'block', 'allow', 'transfer', 'close']) {
      expect(payload).toContain(`biri:hub:${action}`);
    }
  });

  it('is read-only for members but writable for Biri', async () => {
    const h = await hubHarness();
    const everyone = h.panel.permissionOverwrites.cache.get(h.guild.id)!;
    expect(everyone.deny.bitfield & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    const bot = h.panel.permissionOverwrites.cache.get(h.guild.members.me.id)!;
    expect(bot.allow.bitfield & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
  });

  it('never duplicates: setup again edits the same message', async () => {
    const h = await hubHarness();
    const second = await h.service.setup(h.g, setupOptions);
    expect(second.panel).toMatchObject({ channelId: h.panel.id, created: false });
    expect(h.panel.sent).toHaveLength(1);
    expect(h.panel.sent[0]!.edit).toHaveBeenCalledTimes(1);
    expect([...h.guild.channels.cache.values()].filter((c) => c.name === HUB_CHANNEL_NAME)).toHaveLength(1);
  });

  it('refreshes the existing panel after a restart and re-posts a deleted message', async () => {
    const h = await hubHarness();
    const restarted = new TempVoiceService(h.repos.tempVoice, h.selfActions, createSilentLogger(), { creationConcurrency: 3 });
    await restarted.recoverGuild(h.g);
    expect(h.panel.sent[0]!.edit).toHaveBeenCalledTimes(1);

    h.panel.sent.length = 0; // someone deleted the panel message
    await restarted.recoverGuild(h.g);
    expect(h.panel.sent).toHaveLength(1);
    expect((await h.repos.tempVoice.getConfig(h.guild.id))?.panelMessageId).toBe(h.panel.sent[0]!.id);
    restarted.shutdown();
  });

  it('forgets a deleted panel channel and recreates it only on setup', async () => {
    const h = await hubHarness();
    h.guild.channels.cache.delete(h.panel.id);
    await h.service.handleChannelDeleted(h.g, h.panel.id);
    expect((await h.repos.tempVoice.getConfig(h.guild.id))?.panelChannelId).toBeNull();

    await h.service.recoverGuild(h.g);
    expect([...h.guild.channels.cache.values()].some((c) => c.name === HUB_CHANNEL_NAME)).toBe(false);

    const again = await h.service.setup(h.g, setupOptions);
    expect(again.panel.created).toBe(true);
  });

  it('reports a failure instead of throwing when Biri cannot create channels', async () => {
    const h = await createVoiceHarness();
    h.guild.failChannelCreate = true;
    const config = (await h.repos.tempVoice.getConfig(h.guild.id))!;
    const result = await h.service.ensurePanel(asDiscord<Guild>(h.guild), config, { create: true });
    expect(result.channelId).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('control panel buttons', () => {
  it('act on the clicking member’s own room', async () => {
    const h = await hubHarness();
    const owner = h.guild.addMember({ name: 'Emirhan' });
    const room = await h.createRoom(owner);
    const { payload } = await h.click(owner, 'lock');
    expect(payload).toContain('Oda kilitlendi');
    expect((await h.repos.tempVoice.findRoomByChannel(room.id))?.locked).toBe(true);
  });

  it('never let someone manage a room they do not own', async () => {
    const h = await hubHarness();
    const owner = h.guild.addMember({ name: 'Sahip' });
    const guest = h.guild.addMember({ name: 'Misafir' });
    const room = await h.createRoom(owner);
    await h.move(guest, room.id);

    const { payload } = await h.click(guest, 'lock');
    expect(payload).toContain('sana ait değil');
    expect((await h.repos.tempVoice.findRoomByChannel(room.id))?.locked).toBe(false);
  });

  it('explain how to start when the member has no room', async () => {
    const h = await hubHarness();
    const { payload } = await h.click(h.guild.addMember({ name: 'Yeni' }), 'hide');
    expect(payload).toContain('Oda Oluştur');
  });

  it('open a user picker bound to the member’s own room', async () => {
    const h = await hubHarness();
    const owner = h.guild.addMember({ name: 'Sahip' });
    const room = await h.createRoom(owner);
    const { payload } = await h.click(owner, 'block');
    expect(payload).toContain(`biri:room:user:block:${room.id}`);
  });

  it('open the settings modal directly', async () => {
    const h = await hubHarness();
    const owner = h.guild.addMember({ name: 'Sahip' });
    await h.createRoom(owner);
    const { interaction } = await h.click(owner, 'settings');
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe('control panel limit menu and renaming', () => {
  it('sets the limit of the member’s own room and resets the shared menu', async () => {
    const h = await hubHarness();
    const owner = h.guild.addMember({ name: 'Sahip' });
    const room = await h.createRoom(owner);
    const { interaction, payload } = await h.pickLimit(owner, '5');
    expect(room.userLimit).toBe(5);
    expect(payload).toContain('**5**');
    expect(interaction.update).toHaveBeenCalledTimes(1);

    await h.pickLimit(owner, '0');
    expect(room.userLimit).toBe(0);
  });

  it('refuses members without a room of their own', async () => {
    const h = await hubHarness();
    const owner = h.guild.addMember({ name: 'Sahip' });
    const guest = h.guild.addMember({ name: 'Misafir' });
    const room = await h.createRoom(owner);
    await h.move(guest, room.id);
    const { payload } = await h.pickLimit(guest, '2');
    expect(payload).toContain('sana ait değil');
    expect(room.userLimit).toBe(0);
  });

  it('renames a panel channel from an earlier version on restart, keeping custom names', async () => {
    const h = await hubHarness();
    h.panel.name = LEGACY_HUB_CHANNEL_NAMES[0]!;
    await h.service.recoverGuild(h.g);
    expect(h.panel.name).toBe(HUB_CHANNEL_NAME);
    expect(h.panel.sent).toHaveLength(1);

    h.panel.name = '🎛️・odalarım';
    await h.service.recoverGuild(h.g);
    expect(h.panel.name).toBe('🎛️・odalarım');
  });

  it('adopts an existing legacy channel on setup instead of creating a second one', async () => {
    const h = await createVoiceHarness();
    const legacy = h.guild.addTextChannel(LEGACY_HUB_CHANNEL_NAMES[0]!, h.category.id);
    const result = await h.service.setup(asDiscord<Guild>(h.guild), setupOptions);
    expect(result.panel).toMatchObject({ channelId: legacy.id, created: false });
    expect(legacy.name).toBe(HUB_CHANNEL_NAME);
  });
});
