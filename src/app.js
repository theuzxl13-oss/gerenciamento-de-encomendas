// API da Gestão de Encomendas – Fazenda da Ilha (Hono). Roda no Cloudflare Workers e no Node.js.
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { HttpError } from './lib/util.js';
import { nowIso } from './lib/time.js';
import { sha256Hex, tokenAleatorio, definirIteracoes } from './lib/seguranca.js';
import { armazenamentoD1, armazenamentoR2 } from './lib/armazenamento.js';
import rotasAuth from './routes/auth.js';
import rotasUsuarios from './routes/usuarios.js';
import rotasQuadras from './routes/quadras.js';
import rotasImportacao from './routes/importacao.js';
import rotasGeral from './routes/geral.js';
import rotasAnexos from './routes/anexos.js';
import rotasRelatorios from './routes/relatorios.js';
import rotasEncomendas from './routes/encomendas.js';

export const COOKIE = 'fi_sessao';
export const SESSAO_INATIVIDADE_MS = 12 * 60 * 60 * 1000;

export function cookieSessao(c, token, maxAgeMs) {
  const seguro = new URL(c.req.url).protocol === 'https:';
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (seguro) attrs.push('Secure');
  if (maxAgeMs !== undefined) attrs.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  c.header('Set-Cookie', attrs.join('; '));
}

export async function criarSessao(c, usuarioId) {
  const token = tokenAleatorio();
  const db = c.get('db');
  await db.prepare(`INSERT INTO sessoes (id, usuario_id, criado_em, ultimo_uso_em, expira_em, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256Hex(token), usuarioId, nowIso(), nowIso(), new Date(Date.now() + SESSAO_INATIVIDADE_MS).toISOString(),
      c.req.header('cf-connecting-ip') || c.get('ip') || null, String(c.req.header('user-agent') || '').slice(0, 300)).run();
  cookieSessao(c, token);
}

export const requireAuth = async (c, next) => {
  if (!c.get('user')) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
  await next();
};
export const requireAdmin = async (c, next) => {
  if (!c.get('user')) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
  if (c.get('user').perfil !== 'ADMIN') throw new HttpError(403, 'Acesso restrito ao administrador.');
  await next();
};

export function criarApp() {
  const app = new Hono().basePath('/api');

  // Recursos do ambiente: banco (D1 ou SQLite compatível) e armazenamento de arquivos.
  app.use('*', async (c, next) => {
    const env = c.env || {};
    c.set('db', env.DB);
    c.set('arq', env.ARMAZENAMENTO || (env.ARQUIVOS ? armazenamentoR2(env.ARQUIVOS) : armazenamentoD1(env.DB)));
    c.set('ambiente', env.AMBIENTE || 'cloudflare');
    if (env.PBKDF2_ITERACOES) definirIteracoes(env.PBKDF2_ITERACOES);
    c.set('ip', env.IP_CLIENTE ? env.IP_CLIENTE(c) : null);
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });

  // Proteção CSRF: toda escrita exige o cabeçalho enviado pelo front-end.
  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-requested-with') !== 'FazendaDaIlha') {
      throw new HttpError(403, 'Requisição bloqueada (proteção CSRF).');
    }
    await next();
  });

  // Sessão
  app.use('*', async (c, next) => {
    const token = getCookie(c, COOKIE);
    if (token) {
      const db = c.get('db');
      const sid = await sha256Hex(token);
      const row = await db.prepare(`SELECT s.id sid, s.expira_em, u.id, u.nome, u.login, u.email, u.perfil, u.ativo, u.trocar_senha
                                     FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = ?`).bind(sid).first();
      if (row && row.ativo && row.expira_em > nowIso()) {
        await db.prepare('UPDATE sessoes SET ultimo_uso_em = ?, expira_em = ? WHERE id = ?')
          .bind(nowIso(), new Date(Date.now() + SESSAO_INATIVIDADE_MS).toISOString(), sid).run();
        c.set('sessionId', sid);
        c.set('user', { id: row.id, nome: row.nome, login: row.login, email: row.email, perfil: row.perfil, trocar_senha: !!row.trocar_senha });
      } else if (row) {
        await db.prepare('DELETE FROM sessoes WHERE id = ?').bind(sid).run();
      }
    }
    await next();
  });

  app.get('/saude', (c) => c.json({ ok: true, hora: nowIso(), ambiente: c.get('ambiente') }));
  rotasAuth(app);
  rotasUsuarios(app);
  rotasImportacao(app);
  rotasQuadras(app);
  rotasGeral(app);
  rotasAnexos(app);
  rotasRelatorios(app);
  rotasEncomendas(app);

  app.notFound((c) => c.json({ erro: 'Rota não encontrada.' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ erro: err.message, ...(err.extra || {}) }, err.status);
    if (err instanceof SyntaxError) return c.json({ erro: 'Dados inválidos.' }, 400);
    console.error('[erro]', c.req.method, c.req.path, err && err.stack ? err.stack : err);
    return c.json({ erro: 'Erro interno. A operação não foi concluída.' }, 500);
  });
  return app;
}

// Lê o corpo JSON com segurança
export async function corpo(c) {
  try { return (await c.req.json()) || {}; } catch { throw new HttpError(400, 'JSON inválido.'); }
}
