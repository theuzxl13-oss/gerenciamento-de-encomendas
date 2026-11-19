// Inicia o sistema para os testes:
//   ALVO=node (padrão)   → servidor Node.js com SQLite local
//   ALVO=cloudflare      → Cloudflare Workers local (workerd + D1 + assets) via `wrangler dev`
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { criarServidorNode } from '../src/node.js';

export const ALVO = process.env.ALVO === 'cloudflare' ? 'cloudflare' : 'node';
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = path.join(RAIZ, 'node_modules', '.bin', 'wrangler');
const NOME_DB = 'encomendas-fazenda-da-ilha';

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fi-enc-test-'));

function portaLivre() {
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}

async function iniciarCloudflare(dataDir) {
  const persist = path.join(dataDir, 'wrangler');
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', NOME_DB, '--local', '--persist-to', persist], { cwd: RAIZ, env, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error('Falha ao aplicar migrações D1:\n' + mig.stdout + mig.stderr);
  const porta = await portaLivre();
  const proc = spawn(WRANGLER, ['dev', '--port', String(porta), '--ip', '127.0.0.1', '--persist-to', persist, '--show-interactive-dev-session=false'],
    { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(base + '/api/saude'); if (r.ok) break; } catch { /* aguardando */ }
    if (proc.exitCode !== null) throw new Error('wrangler dev encerrou:\n' + log);
    await new Promise((r) => setTimeout(r, 500));
    if (i === 119) throw new Error('wrangler dev não respondeu:\n' + log);
  }
  return {
    alvo: 'cloudflare', base, dataDir, log: () => log,
    // Executa SQL direto no banco D1 local (usado para provar as proteções do banco).
    async sql(q) {
      const r = spawnSync(WRANGLER, ['d1', 'execute', NOME_DB, '--local', '--persist-to', persist, '--command', q], { cwd: RAIZ, env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stdout + r.stderr);
      return r.stdout;
    },
    parar: () => new Promise((ok) => { proc.once('exit', ok); proc.kill('SIGTERM'); setTimeout(() => proc.kill('SIGKILL'), 5000).unref(); }),
  };
}

export async function iniciar(dataDir = tmpDir()) {
  if (ALVO === 'cloudflare') return iniciarCloudflare(dataDir);
  const s = await criarServidorNode({ dataDir, porta: 0, host: '127.0.0.1', log: { log() {}, error: console.error } });
  return {
    alvo: 'node', base: s.base, dataDir, parar: s.parar,
    async sql(q) { return s.db.sqlite.prepare(q).run(); },
  };
}

// Cliente HTTP com cookie de sessão
export function cliente(base) {
  let cookie = '';
  async function req(method, url, body, { raw = false, headers = {} } = {}) {
    const h = { 'X-Requested-With': 'FazendaDaIlha', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  return {
    get: (u, o) => req('GET', u, undefined, o),
    post: (u, b, o) => req('POST', u, b, o),
    put: (u, b, o) => req('PUT', u, b, o),
    del: (u, b, o) => req('DELETE', u, b, o),
    req,
    get cookie() { return cookie; },
  };
}
