'use strict';
const express = require('express');
const { nowIso } = require('../time');
const { bad, notFound, conflict, str } = require('../util');
const { audit, diff } = require('../audit');
const A = require('../auth');

const PERFIS = ['ADMIN', 'CONTROLADOR'];
const CAMPOS_PUBLICOS = 'id, nome, login, email, perfil, ativo, trocar_senha, ultimo_login_em, bloqueado_ate, criado_em, atualizado_em';

module.exports = function usuariosRoutes({ db }) {
  const r = express.Router();

  // Lista mínima para seleção (funcionário que recebeu / controlador que entregou)
  r.get('/usuarios/lista', A.requireAuth, (req, res) => {
    const todos = req.query.todos === '1';
    res.json(db.prepare(`SELECT id, nome, perfil, ativo FROM usuarios ${todos ? '' : 'WHERE ativo = 1'} ORDER BY nome`).all());
  });

  r.get('/usuarios', A.requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios ORDER BY ativo DESC, nome`).all());
  });

  function validar(body, parcial = false) {
    const out = {};
    if (!parcial || body.nome !== undefined) { out.nome = str(body.nome, 120); if (!out.nome) throw bad('Informe o nome.'); }
    if (!parcial || body.login !== undefined) {
      out.login = str(body.login, 60);
      if (!out.login || !/^[a-zA-Z0-9._-]{3,60}$/.test(out.login)) throw bad('Usuário deve ter 3 a 60 caracteres (letras, números, ponto, hífen ou sublinhado).');
      out.login = out.login.toLowerCase();
    }
    if (!parcial || body.email !== undefined) {
      out.email = str(body.email, 160);
      if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw bad('E-mail inválido.');
    }
    if (!parcial || body.perfil !== undefined) {
      out.perfil = String(body.perfil || '').toUpperCase();
      if (!PERFIS.includes(out.perfil)) throw bad('Perfil inválido.');
    }
    if (body.ativo !== undefined) out.ativo = body.ativo ? 1 : 0;
    return out;
  }

  function unico(campos, id = 0) {
    if (campos.login && db.prepare('SELECT 1 FROM usuarios WHERE login = ? AND id <> ?').get(campos.login, id)) throw conflict('Já existe um usuário com este login.');
    if (campos.email && db.prepare('SELECT 1 FROM usuarios WHERE email = ? AND id <> ?').get(campos.email, id)) throw conflict('Já existe um usuário com este e-mail.');
  }

  r.post('/usuarios', A.requireAdmin, (req, res) => {
    const c = validar(req.body);
    A.validarSenha(req.body.senha);
    unico(c);
    const now = nowIso();
    const info = db.prepare(`INSERT INTO usuarios (nome, login, email, senha_hash, perfil, ativo, trocar_senha, criado_em, criado_por_id, atualizado_em)
                             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .run(c.nome, c.login, c.email, A.hashSenha(req.body.senha), c.perfil, req.body.trocar_senha === false ? 0 : 1, now, req.user.id, now);
    const id = Number(info.lastInsertRowid);
    audit(db, req, { acao: 'USUARIO_CRIADO', entidade: 'usuario', entidadeId: id, detalhes: { nome: c.nome, login: c.login, email: c.email, perfil: c.perfil } });
    res.status(201).json(db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).get(id));
  });

  r.put('/usuarios/:id', A.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const antes = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!antes) throw notFound();
    const c = validar(req.body, true);
    unico(c, id);
    if (id === req.user.id && (c.ativo === 0 || (c.perfil && c.perfil !== 'ADMIN'))) {
      throw bad('Você não pode desativar ou rebaixar o seu próprio usuário.');
    }
    const depois = { ...antes, ...c };
    if (antes.perfil === 'ADMIN' && antes.ativo && (depois.perfil !== 'ADMIN' || !depois.ativo)) {
      const admins = db.prepare("SELECT COUNT(*) n FROM usuarios WHERE perfil = 'ADMIN' AND ativo = 1").get().n;
      if (admins <= 1) throw bad('É necessário manter pelo menos um administrador ativo.');
    }
    db.prepare('UPDATE usuarios SET nome = ?, login = ?, email = ?, perfil = ?, ativo = ?, atualizado_em = ? WHERE id = ?')
      .run(depois.nome, depois.login, depois.email, depois.perfil, depois.ativo, nowIso(), id);
    if (!depois.ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    audit(db, req, { acao: 'USUARIO_EDITADO', entidade: 'usuario', entidadeId: id, detalhes: diff(antes, depois, ['nome', 'login', 'email', 'perfil', 'ativo']) });
    res.json(db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).get(id));
  });

  r.post('/usuarios/:id/redefinir-senha', A.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM usuarios WHERE id = ?').get(id)) throw notFound();
    A.validarSenha(req.body.senha);
    db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = NULL, atualizado_em = ? WHERE id = ?')
      .run(A.hashSenha(req.body.senha), nowIso(), id);
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    audit(db, req, { acao: 'SENHA_REDEFINIDA', entidade: 'usuario', entidadeId: id });
    res.json({ ok: true });
  });

  return r;
};
