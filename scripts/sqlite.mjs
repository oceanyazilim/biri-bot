// Derives an SQLite schema from prisma/schema.prisma for local development,
// generates the Prisma client for it and pushes the schema to the SQLite file.
// Run `npm run db:generate` afterwards to switch the client back to PostgreSQL.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
const sqlite = source.replace('provider = "postgresql"', 'provider = "sqlite"');
if (sqlite === source) {
  console.error('PostgreSQL provider satırı bulunamadı; şema değiştirilmedi.');
  process.exit(1);
}

const outDir = join(root, 'prisma', 'sqlite');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'schema.prisma');
writeFileSync(outFile, sqlite);
console.log(`SQLite şeması yazıldı: ${outFile}`);

const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
run(`npx prisma generate --schema "${outFile}"`);
run(`npx prisma db push --skip-generate --schema "${outFile}"`);
console.log('SQLite veritabanı hazır. PostgreSQL istemcisine dönmek için: npm run db:generate');
