'use strict';
const crypto = require('crypto');
const { nowIso } = require('./time');
const { HttpError, forbidden } = require('./util');

const COOKIE = 'fi_sessao';
const SESSAO_INATIVIDADE_MS = 12 * 60 * 60 * 1000; // 12 h sem uso encerra a sessão
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verificarSenha(senha, armazenado) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = armazenado.split('$');
    if (alg !== 'scrypt') return false;
    const esperado = Buffer.from(hashB64, 'base64');
    const calc = crypto.scryptSync(senha, Buffer.from(saltB64, 'base64'), esperado.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(esperado, calc);
  } catch {
    return false;
  }
}

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) {
    throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
  }
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
    throw new HttpError(400, 'A senha deve conter letras e números.');
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function criarSessao(db, usuarioId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const agora = Date.now();
  db.prepare(`INSERT INTO sessoes (id, usuario_id, criado_em, ultimo_uso_em, expira_em, ip, user_agent)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sha256(token), usuarioId, nowIso(), nowIso(), new Date(agora + SESSAO_INATIVIDADE_MS).toISOString(),
      req.ip, String(req.headers['user-agent'] || '').slice(0, 300));
  return token;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(token, { secure, maxAgeMs }) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) attrs.push('Secure');
  if (maxAgeMs !== undefined) attrs.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return attrs.join('; ');
}

// Middleware: carrega usuário da sessão (se houver).
function sessionMiddleware(db) {
  const buscar = db.prepare(`SELECT s.id sid, s.expira_em, u.id, u.nome, u.login, u.email, u.perfil, u.ativo, u.trocar_senha
                             FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = ?`);
  const tocar = db.prepare('UPDATE sessoes SET ultimo_uso_em = ?, expira_em = ? WHERE id = ?');
  const apagar = db.prepare('DELETE FROM sessoes WHERE id = ?');
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const sid = sha256(token);
      const row = buscar.get(sid);
      if (row && row.ativo && row.expira_em > nowIso()) {
        tocar.run(nowIso(), new Date(Date.now() + SESSAO_INATIVIDADE_MS).toISOString(), sid);
        req.sessionId = sid;
        req.user = { id: row.id, nome: row.nome, login: row.login, email: row.email, perfil: row.perfil, trocar_senha: !!row.trocar_senha };
      } else if (row) {
        apagar.run(sid);
      }
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Faça login novamente.'));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Faça login novamente.'));
  if (req.user.perfil !== 'ADMIN') return next(forbidden('Acesso restrito ao administrador.'));
  next();
}

// Proteção CSRF: toda escrita na API exige o cabeçalho X-Requested-With enviado pelo front-end.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'FazendaDaIlha') {
    return next(new HttpError(403, 'Requisição bloqueada (proteção CSRF).'));
  }
  next();
}

module.exports = {
  COOKIE, MAX_TENTATIVAS, BLOQUEIO_MS, SESSAO_INATIVIDADE_MS,
  hashSenha, verificarSenha, validarSenha, criarSessao, cookieHeader,
  sessionMiddleware, requireAuth, requireAdmin, csrfGuard, sha256,
};
