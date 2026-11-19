'use strict';
const express = require('express');
const { nowIso } = require('../time');
const { HttpError, bad, str } = require('../util');
const { audit } = require('../audit');
const A = require('../auth');

module.exports = function authRoutes({ db, secureCookies }) {
  const r = express.Router();

  const totalUsuarios = () => db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;

  // Primeiro acesso: só permite criar o administrador inicial se o banco não tem usuários.
  r.get('/setup', (req, res) => res.json({ precisa_configurar: totalUsuarios() === 0 }));

  r.post('/setup', (req, res) => {
    const nome = str(req.body.nome, 120);
    const login = str(req.body.login, 60);
    const email = str(req.body.email, 160);
    if (!nome || !login) throw bad('Informe nome e usuário.');
    A.validarSenha(req.body.senha);
    const criar = db.transaction(() => {
      if (totalUsuarios() > 0) throw new HttpError(409, 'O sistema já foi configurado.');
      const now = nowIso();
      const info = db.prepare(`INSERT INTO usuarios (nome, login, email, senha_hash, perfil, criado_em, atualizado_em)
                               VALUES (?, ?, ?, ?, 'ADMIN', ?, ?)`)
        .run(nome, login.toLowerCase(), email, A.hashSenha(req.body.senha), now, now);
      const u = { id: Number(info.lastInsertRowid), nome };
      audit(db, req, { acao: 'CONFIGURACAO_INICIAL', entidade: 'usuario', entidadeId: u.id, usuario: u, detalhes: { login, perfil: 'ADMIN' } });
      return u;
    });
    const u = criar();
    const token = A.criarSessao(db, u.id, req);
    res.setHeader('Set-Cookie', A.cookieHeader(token, { secure: secureCookies }));
    res.status(201).json({ ok: true });
  });

  r.post('/auth/login', (req, res) => {
    const login = str(req.body.login, 160);
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!login || !senha) throw bad('Informe usuário e senha.');
    const u = db.prepare('SELECT * FROM usuarios WHERE login = ? OR email = ?').get(login, login);
    const falha = () => { throw new HttpError(401, 'Usuário ou senha inválidos.'); };
    if (!u) { A.verificarSenha(senha, A.hashSenha('x'.repeat(8) + '1')); falha(); }
    if (u.bloqueado_ate && u.bloqueado_ate > nowIso()) {
      throw new HttpError(423, 'Usuário temporariamente bloqueado por excesso de tentativas. Aguarde 15 minutos ou procure o administrador.');
    }
    if (!A.verificarSenha(senha, u.senha_hash)) {
      const tent = u.tentativas_falhas + 1;
      const bloquear = tent >= A.MAX_TENTATIVAS;
      db.prepare('UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?')
        .run(bloquear ? 0 : tent, bloquear ? new Date(Date.now() + A.BLOQUEIO_MS).toISOString() : null, u.id);
      audit(db, req, { acao: bloquear ? 'LOGIN_BLOQUEADO' : 'LOGIN_FALHOU', entidade: 'usuario', entidadeId: u.id, usuario: { id: u.id, nome: u.nome } });
      falha();
    }
    if (!u.ativo) throw new HttpError(403, 'Usuário desativado. Procure o administrador.');
    db.prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login_em = ? WHERE id = ?').run(nowIso(), u.id);
    db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(nowIso());
    const token = A.criarSessao(db, u.id, req);
    audit(db, req, { acao: 'LOGIN', entidade: 'usuario', entidadeId: u.id, usuario: { id: u.id, nome: u.nome } });
    res.setHeader('Set-Cookie', A.cookieHeader(token, { secure: secureCookies }));
    res.json({ ok: true });
  });

  r.post('/auth/logout', (req, res) => {
    if (req.sessionId) {
      db.prepare('DELETE FROM sessoes WHERE id = ?').run(req.sessionId);
      audit(db, req, { acao: 'LOGOUT', entidade: 'usuario', entidadeId: req.user.id });
    }
    res.setHeader('Set-Cookie', A.cookieHeader('', { secure: secureCookies, maxAgeMs: 0 }));
    res.json({ ok: true });
  });

  r.get('/auth/me', A.requireAuth, (req, res) => res.json(req.user));

  r.post('/auth/senha', A.requireAuth, (req, res) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
    if (!A.verificarSenha(String(req.body.senha_atual || ''), u.senha_hash)) throw bad('Senha atual incorreta.');
    A.validarSenha(req.body.nova_senha);
    db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, atualizado_em = ? WHERE id = ?')
      .run(A.hashSenha(req.body.nova_senha), nowIso(), u.id);
    // encerra outras sessões do usuário
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND id <> ?').run(u.id, req.sessionId);
    audit(db, req, { acao: 'SENHA_ALTERADA', entidade: 'usuario', entidadeId: u.id });
    res.json({ ok: true });
  });

  return r;
};
