#!/usr/bin/env node
'use strict';
// Utilitário de linha de comando:
//   node scripts/admin.js criar-admin <login> <nome completo>     (pede a senha via variável SENHA)
//   node scripts/admin.js redefinir-senha <login>                 (nova senha via variável SENHA)
//   node scripts/admin.js backup
process.env.TZ = 'America/Sao_Paulo';
const path = require('path');
const { openDatabase } = require('../server/db');
const { hashSenha, validarSenha } = require('../server/auth');
const { criarBackup } = require('../server/backup');
const { audit } = require('../server/audit');
const { nowIso } = require('../server/time');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const db = openDatabase(DATA_DIR);
const [cmd, ...args] = process.argv.slice(2);
const sistema = { id: null, nome: 'Linha de comando' };

try {
  if (cmd === 'criar-admin') {
    const [login, ...nome] = args;
    if (!login || !nome.length) throw new Error('Uso: SENHA=... node scripts/admin.js criar-admin <login> <nome completo>');
    validarSenha(process.env.SENHA || '');
    const now = nowIso();
    const info = db.prepare(`INSERT INTO usuarios (nome, login, senha_hash, perfil, trocar_senha, criado_em, atualizado_em)
                             VALUES (?, ?, ?, 'ADMIN', 1, ?, ?)`).run(nome.join(' '), login.toLowerCase(), hashSenha(process.env.SENHA), now, now);
    audit(db, null, { acao: 'USUARIO_CRIADO', entidade: 'usuario', entidadeId: Number(info.lastInsertRowid), usuario: sistema, detalhes: { login, perfil: 'ADMIN', origem: 'cli' } });
    console.log(`Administrador "${login}" criado.`);
  } else if (cmd === 'redefinir-senha') {
    const [login] = args;
    validarSenha(process.env.SENHA || '');
    const u = db.prepare('SELECT id FROM usuarios WHERE login = ?').get(login);
    if (!u) throw new Error('Usuário não encontrado.');
    db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = NULL, ativo = 1, atualizado_em = ? WHERE id = ?')
      .run(hashSenha(process.env.SENHA), nowIso(), u.id);
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
    audit(db, null, { acao: 'SENHA_REDEFINIDA', entidade: 'usuario', entidadeId: u.id, usuario: sistema, detalhes: { origem: 'cli' } });
    console.log('Senha redefinida.');
  } else if (cmd === 'backup') {
    const b = criarBackup(db, DATA_DIR, 'manual');
    console.log(`Backup criado: ${path.join(DATA_DIR, 'backups', b.nome)}`);
  } else {
    console.log('Comandos: criar-admin <login> <nome>, redefinir-senha <login>, backup  (senha na variável de ambiente SENHA)');
  }
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
