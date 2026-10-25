import { GUARD_MODULE_DEFAULTS } from '../../config/constants';
import type { GuardConfigUpdate, GuardRepository, ModuleConfigUpdate } from '../../database/repositories/types';
import { splitCsv } from '../../utils/format';
import {
  GUARD_MODULES,
  isGuardModule,
  isProtectionMode,
  type GuardModule,
  type GuardModuleSettings,
  type GuardSettings,
} from '../../types/guard';

export function defaultModuleSettings(module: GuardModule): GuardModuleSettings {
  return { module, ...GUARD_MODULE_DEFAULTS[module] };
}

/** Loads per-guild Guard settings (merged with defaults) and caches them. */
export class GuardConfigService {
  private readonly cache = new Map<string, GuardSettings>();

  constructor(private readonly repo: GuardRepository) {}

  async get(guildId: string): Promise<GuardSettings> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const [config, moduleRows] = await Promise.all([this.repo.getConfig(guildId), this.repo.listModules(guildId)]);

    const modules = {} as Record<GuardModule, GuardModuleSettings>;
    for (const module of GUARD_MODULES) modules[module] = defaultModuleSettings(module);
    for (const row of moduleRows) {
      if (!isGuardModule(row.module)) continue;
      modules[row.module] = {
        module: row.module,
        enabled: row.enabled,
        warnThreshold: row.warnThreshold,
        threshold: row.threshold,
        windowSec: row.windowSec,
        severity: row.severity === 'HIGH' ? 'HIGH' : 'CRITICAL',
        autoStrip: row.autoStrip,
      };
    }

    const settings: GuardSettings = {
      guildId,
      enabled: config?.enabled ?? false,
      mode: config && isProtectionMode(config.mode) ? config.mode : 'ALERT',
      incidentCooldownSec: config?.incidentCooldownSec ?? 300,
      logRetentionDays: config?.logRetentionDays ?? 90,
      notifyOwner: config?.notifyOwner ?? true,
      notifyRoleIds: splitCsv(config?.notifyRoleIds ?? ''),
      modules,
    };
    this.cache.set(guildId, settings);
    return settings;
  }

  async update(guildId: string, update: GuardConfigUpdate): Promise<GuardSettings> {
    await this.repo.upsertConfig(guildId, update);
    this.cache.delete(guildId);
    return this.get(guildId);
  }

  async updateModule(guildId: string, module: GuardModule, update: ModuleConfigUpdate): Promise<GuardModuleSettings> {
    const defaults = GUARD_MODULE_DEFAULTS[module];
    await this.repo.upsertModule(guildId, module, { ...defaults }, update);
    this.cache.delete(guildId);
    return (await this.get(guildId)).modules[module];
  }

  /** Persists default rows for every module so they are visible and editable. */
  async ensureModules(guildId: string): Promise<void> {
    const existing = new Set((await this.repo.listModules(guildId)).map((row) => row.module));
    for (const module of GUARD_MODULES) {
      if (!existing.has(module)) await this.repo.upsertModule(guildId, module, { ...GUARD_MODULE_DEFAULTS[module] }, {});
    }
    this.cache.delete(guildId);
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
