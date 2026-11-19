// Ponto de entrada no Node.js: servidor próprio (computador da portaria, VPS) e testes automatizados.
// Usa as MESMAS rotas do Cloudflare, com SQLite local (interface D1) e arquivos em disco.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { criarApp } from './app.js';
import { SqliteD1 } from './runtime/sqlite-d1.js';
import { localParts } from './lib/time.js';
import { getConfig } from './lib/config.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(RAIZ, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
// Mesmos cabeçalhos de segurança de public/_headers (usado pela Cloudflare).
const CABECALHOS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

function armazenamentoDisco(pasta) {
  return {
    tipo: 'disco',
    limiteBytes: 10 * 1024 * 1024,
    async put(chave, bytes) {
      const destino = path.join(pasta, chave);
      if (!destino.startsWith(pasta + path.sep)) throw new Error('Chave inválida');
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, bytes, { mode: 0o600 });
    },
    async get(chave) {
      const origem = path.join(pasta, chave);
      if (!origem.startsWith(pasta + path.sep) || !fs.existsSync(origem)) return null;
      return { corpo: fs.readFileSync(origem) };
    },
  };
}

function backups(db, dataDir) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const listar = () => fs.readdirSync(dir).filter((f) => /^encomendas-.*\.db$/.test(f))
    .map((f) => { const st = fs.statSync(path.join(dir, f)); return { nome: f, tamanho: st.size, criado_em: st.mtime.toISOString() }; })
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  return {
    listar,
    criar(tipo) {
      const p = localParts();
      const nome = `encomendas-${p.date}_${p.time.replace(':', '')}${p.seconds}-${tipo}.db`;
      const destino = path.join(dir, nome);
      if (fs.existsSync(destino)) fs.unlinkSync(destino);
      db.backup(destino);
      return { nome, tamanho: fs.statSync(destino).size };
    },
    ler(nome) {
      const n = path.basename(String(nome));
      const f = path.join(dir, n);
      if (!/^encomendas-.*\.db$/.test(n) || !fs.existsSync(f)) return null;
      return { nome: n, corpo: fs.readFileSync(f) };
    },
    limpar(dias) {
      const limite = Date.now() - dias * 86400000;
      for (const b of listar()) if (b.nome.endsWith('-automatico.db') && new Date(b.criado_em).getTime() < limite) fs.unlinkSync(path.join(dir, b.nome));
    },
  };
}

async function servirEstatico(req) {
  const url = new URL(req.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let arquivo = path.join(PUBLIC, rel);
  if (!arquivo.startsWith(PUBLIC) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory() || path.basename(arquivo).startsWith('_')) {
    arquivo = path.join(PUBLIC, 'index.html'); // SPA
  }
  return new Response(fs.readFileSync(arquivo), {
    headers: { 'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...CABECALHOS },
  });
}

export function criarServidorNode({ dataDir, porta = 3000, host = '0.0.0.0', backupAutomatico = false, log = console } = {}) {
  process.env.TZ = 'America/Sao_Paulo';
  const db = new SqliteD1(path.join(dataDir, 'encomendas.db'));
  db.migrar(path.join(RAIZ, 'migrations'));
  const B = backups(db, dataDir);
  const env = { DB: db, ARMAZENAMENTO: armazenamentoDisco(path.join(dataDir, 'uploads')), AMBIENTE: 'node', BACKUP: B };
  const app = criarApp();
  const fetch = async (req, nodeEnv) => {
    if (new URL(req.url).pathname.startsWith('/api/')) {
      const res = await app.fetch(req, { ...env, incoming: nodeEnv && nodeEnv.incoming, IP_CLIENTE: () => nodeEnv?.incoming?.socket?.remoteAddress || null });
      for (const [k, v] of Object.entries(CABECALHOS)) if (!res.headers.has(k)) res.headers.set(k, v);
      return res;
    }
    return servirEstatico(req);
  };
  let timer = null;
  if (backupAutomatico) {
    const tick = async () => {
      try {
        const cfg = await getConfig(db);
        if (!cfg.backup_automatico) return;
        const hoje = localParts().date;
        if (!B.listar().some((b) => b.nome.startsWith(`encomendas-${hoje}`) && b.nome.endsWith('-automatico.db'))) log.log('[backup] criado:', B.criar('automatico').nome);
        B.limpar(Number(cfg.backup_retencao_dias) || 30);
      } catch (e) { log.error('[backup] falha:', e.message); }
    };
    setTimeout(tick, 5000).unref();
    timer = setInterval(tick, 3600000);
    timer.unref();
  }
  return new Promise((resolve) => {
    const server = serve({ fetch, port: porta, hostname: host }, (info) => {
      resolve({
        db, porta: info.port, base: `http://127.0.0.1:${info.port}`,
        parar: () => new Promise((r) => { clearInterval(timer); server.close(() => { db.close(); r(); }); }),
      });
    });
  });
}

// Execução direta: node src/node.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(RAIZ, 'data'));
  const s = await criarServidorNode({ dataDir, porta: Number(process.env.PORT) || 3000, host: process.env.HOST || '0.0.0.0', backupAutomatico: true });
  console.log(`Gestão de Encomendas – Fazenda da Ilha rodando em http://localhost:${s.porta}`);
  console.log(`Dados em: ${dataDir}`);
  const encerrar = () => s.parar().then(() => process.exit(0));
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}
