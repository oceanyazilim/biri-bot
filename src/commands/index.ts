import type { SlashCommand } from '../types/command';
import kur from './admin/kur';
import yardim from './admin/yardim';
import guardAc from './guard/guard-ac';
import guardAyar from './guard/guard-ayar';
import guardDurum from './guard/guard-durum';
import guardEsik from './guard/guard-esik';
import guardGuvenilirCikar from './guard/guard-guvenilir-cikar';
import guardGuvenilirEkle from './guard/guard-guvenilir-ekle';
import guardGuvenilirListe from './guard/guard-guvenilir-liste';
import guardIade from './guard/guard-iade';
import guardKapat from './guard/guard-kapat';
import guardKur from './guard/guard-kur';
import guardMod from './guard/guard-mod';
import guardModul from './guard/guard-modul';
import guardOlaylar from './guard/guard-olaylar';
import guardYetkili from './guard/guard-yetkili';
import ac from './voice/ac';
import at from './voice/at';
import devret from './voice/devret';
import engelKaldir from './voice/engel-kaldir';
import engelle from './voice/engelle';
import gizle from './voice/gizle';
import goster from './voice/goster';
import isim from './voice/isim';
import izinKaldir from './voice/izin-kaldir';
import izinVer from './voice/izin-ver';
import kilit from './voice/kilit';
import limit from './voice/limit';
import limitsiz from './voice/limitsiz';
import oda from './voice/oda';
import odaSil from './voice/oda-sil';
import odam from './voice/odam';

export const ALL_COMMANDS: SlashCommand[] = [
  // Temp voice
  kilit,
  ac,
  at,
  isim,
  limit,
  limitsiz,
  gizle,
  goster,
  engelle,
  engelKaldir,
  izinVer,
  izinKaldir,
  devret,
  oda,
  odam,
  odaSil,
  // Guard
  guardKur,
  guardAc,
  guardKapat,
  guardDurum,
  guardMod,
  guardEsik,
  guardModul,
  guardAyar,
  guardGuvenilirEkle,
  guardGuvenilirCikar,
  guardGuvenilirListe,
  guardYetkili,
  guardOlaylar,
  guardIade,
  // Admin
  kur,
  yardim,
];

export function buildCommandMap(commands: SlashCommand[] = ALL_COMMANDS): Map<string, SlashCommand> {
  const map = new Map<string, SlashCommand>();
  for (const command of commands) {
    if (map.has(command.data.name)) throw new Error(`Komut adı iki kez tanımlandı: ${command.data.name}`);
    map.set(command.data.name, command);
  }
  return map;
}

export function commandPayloads(commands: SlashCommand[] = ALL_COMMANDS) {
  return commands.map((command) => command.data.toJSON());
}
