#!/usr/bin/env node
// Cópia completa do banco D1 publicado na Cloudflare para um arquivo .sql local (pasta backups/).
// Uso: npm run backup:cloudflare   (requer `npx wrangler login` feito uma vez)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localParts } from '../src/lib/time.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = localParts();
const dir = path.join(RAIZ, 'backups');
fs.mkdirSync(dir, { recursive: true });
const destino = path.join(dir, `encomendas-cloudflare-${p.date}_${p.time.replace(':', '')}.sql`);
const r = spawnSync(path.join(RAIZ, 'node_modules', '.bin', 'wrangler'),
  ['d1', 'export', 'encomendas-fazenda-da-ilha', '--remote', '--output', destino], { cwd: RAIZ, stdio: 'inherit' });
if (r.status === 0) console.log(`\nBackup salvo em: ${destino}\nGuarde uma cópia fora deste computador (nuvem, pen drive).`);
process.exit(r.status ?? 1);
