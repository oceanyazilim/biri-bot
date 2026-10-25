import { describe, expect, it } from 'vitest';
import { DISCORD_CHANNEL_NAME_MAX } from '../src/config/constants';
import { buildRoomName, sanitizeName, turkishGenitive, validateCustomRoomName } from '../src/modules/tempVoice/roomNaming';

describe('Turkish room naming', () => {
  it.each([
    ['Emirhan', "Emirhan'ın"],
    ['Ahmet', "Ahmet'in"],
    ['Mehmet', "Mehmet'in"],
    ['Ayşe', "Ayşe'nin"],
    ['Ali', "Ali'nin"],
    ['Burak', "Burak'ın"],
    ['Okan', "Okan'ın"],
    ['Umut', "Umut'un"],
    ['Göktürk', "Göktürk'ün"],
    ['Kuzu', "Kuzu'nun"],
    ['Ömür', "Ömür'ün"],
    ['İLKER', "İLKER'in"],
  ])('%s → %s', (name, expected) => {
    expect(turkishGenitive(name)).toBe(expected);
  });

  it('falls back when no suffix can be derived', () => {
    expect(turkishGenitive('XYZ')).toBeNull();
    expect(buildRoomName('XYZ')).toBe('🔊・XYZ Odası');
    expect(buildRoomName('Ali 🔥')).toBe('🔊・Ali 🔥 Odası');
  });

  it('builds the expected channel name', () => {
    expect(buildRoomName('Emirhan')).toBe("🔊・Emirhan'ın Odası");
  });

  it('respects the Discord name limit without splitting emoji', () => {
    const name = buildRoomName('😀'.repeat(150));
    expect(Array.from(name).length).toBeLessThanOrEqual(DISCORD_CHANNEL_NAME_MAX);
    expect(name).not.toMatch(/\uD83D$/);
  });

  it('sanitizes control characters and whitespace', () => {
    expect(sanitizeName('  Em\nir\t han  ')).toBe('Em ir han');
    expect(buildRoomName('   ')).toBe("🔊・Kullanıcı'nın Odası");
  });

  it('validates custom names', () => {
    expect(validateCustomRoomName('Oyun Odası')).toEqual({ ok: true, name: '🔊・Oyun Odası' });
    expect(validateCustomRoomName('   ').ok).toBe(false);
    expect(validateCustomRoomName('gel discord.gg/abc').ok).toBe(false);
    expect(validateCustomRoomName('a'.repeat(120)).ok).toBe(false);
  });
});
