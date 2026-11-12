import { ApplicationFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { fetchPrivilegedIntents, fitToPrivilegedIntents } from '../src/services/privilegedIntents';

const all = { ENABLE_PREFIX_COMMANDS: true, ENABLE_MESSAGE_LOGS: true, ENABLE_GUILD_MEMBERS_INTENT: true };

const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('privileged intents', () => {
  it('reads the portal switches from the application flags', async () => {
    const flags = ApplicationFlags.GatewayMessageContentLimited;
    expect(await fetchPrivilegedIntents('t', respond({ flags }))).toEqual({ messageContent: true, guildMembers: false });
    expect(await fetchPrivilegedIntents('t', respond({ flags: ApplicationFlags.GatewayGuildMembers }))).toEqual({ messageContent: false, guildMembers: true });
    expect(await fetchPrivilegedIntents('t', respond({}, false))).toBeNull();
    expect(await fetchPrivilegedIntents('t', vi.fn(async () => Promise.reject(new Error('ağ'))) as unknown as typeof fetch)).toBeNull();
  });

  it('turns off only the features whose intent is missing (the 4014 crash from production)', () => {
    const { env, warnings } = fitToPrivilegedIntents(all, { messageContent: true, guildMembers: false });
    expect(env).toEqual({ ENABLE_PREFIX_COMMANDS: true, ENABLE_MESSAGE_LOGS: true, ENABLE_GUILD_MEMBERS_INTENT: false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Server Members Intent');
  });

  it('turns off prefix commands and message logs without Message Content', () => {
    const { env, warnings } = fitToPrivilegedIntents(all, { messageContent: false, guildMembers: true });
    expect(env).toMatchObject({ ENABLE_PREFIX_COMMANDS: false, ENABLE_MESSAGE_LOGS: false, ENABLE_GUILD_MEMBERS_INTENT: true });
    expect(warnings[0]).toContain('.yargi');
  });

  it('changes nothing and stays quiet when everything needed is enabled', () => {
    const settings = { ...all, ENABLE_GUILD_MEMBERS_INTENT: false };
    expect(fitToPrivilegedIntents(settings, { messageContent: true, guildMembers: false })).toEqual({ env: settings, warnings: [] });
  });
});
