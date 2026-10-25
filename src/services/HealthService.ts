import { createServer, type Server } from 'node:http';
import type { Client } from 'discord.js';
import type { Logger } from '../utils/logger';

export interface HealthSnapshot {
  status: 'ok' | 'degraded' | 'starting';
  uptimeSec: number;
  discord: { ready: boolean; pingMs: number; guilds: number };
  database: boolean;
  counters: Record<string, number>;
}

/** Tracks runtime counters and optionally serves them on an HTTP endpoint. */
export class HealthService {
  private readonly startedAt = Date.now();
  private readonly counters = new Map<string, number>();
  private server: Server | null = null;

  constructor(
    private readonly client: Client,
    private readonly checkDatabase: () => Promise<boolean>,
    private readonly logger: Logger,
  ) {}

  increment(counter: string, by = 1): void {
    this.counters.set(counter, (this.counters.get(counter) ?? 0) + by);
  }

  async snapshot(): Promise<HealthSnapshot> {
    const database = await this.checkDatabase();
    const ready = this.client.isReady();
    return {
      status: !ready ? 'starting' : database ? 'ok' : 'degraded',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      discord: { ready, pingMs: this.client.ws.ping, guilds: this.client.guilds.cache.size },
      database,
      counters: Object.fromEntries(this.counters),
    };
  }

  listen(port: number): void {
    if (port <= 0) return;
    this.server = createServer((req, res) => {
      if (req.url !== '/health') {
        res.writeHead(404).end();
        return;
      }
      this.snapshot()
        .then((snapshot) => {
          res.writeHead(snapshot.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
          res.end(JSON.stringify(snapshot));
        })
        .catch(() => res.writeHead(500).end());
    });
    this.server.listen(port, () => this.logger.info({ port }, 'Sağlık uç noktası dinleniyor (/health)'));
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = null;
  }
}
