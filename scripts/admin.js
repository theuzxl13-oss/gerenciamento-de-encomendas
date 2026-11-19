#!/usr/bin/env node
// Utilitário de linha de comando para o servidor próprio (Node.js + SQLite):
//   SENHA='...' node scripts/admin.js criar-admin <login> <nome completo>
//   SENHA='...' node scripts/admin.js redefinir-senha <login>
//   node scripts/admin.js backup
// No Cloudflare, use o painel ou `npx wrangler d1 execute` (ver README).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteD1 } from '../src/runtime/sqlite-d1.js';
import { hashSenha, validarSenha } from '../src/lib/seguranca.js';
import { nowIso, localParts } from '../src/lib/time.js';

process.env.TZ = 'America/Sao_Paulo';
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(RAIZ, 'data'));
const db = new SqliteD1(path.join(DATA_DIR, 'encomendas.db'));
db.migrar(path.join(RAIZ, 'migrations'));
const [cmd, ...args] = process.argv.slice(2);
const auditar = (acao, entidadeId, detalhes) => db.prepare(`INSERT INTO auditoria (ocorrido_em, usuario_nome, acao, entidade, entidade_id, detalhes)
  VALUES (?, 'Linha de comando', ?, 'usuario', ?, ?)`).bind(nowIso(), acao, entidadeId, JSON.stringify(detalhes)).run();

try {
  if (cmd === 'criar-admin') {
    const [login, ...nome] = args;
    if (!login || !nome.length) throw new Error("Uso: SENHA='...' node scripts/admin.js criar-admin <login> <nome completo>");
    validarSenha(process.env.SENHA || '');
    const now = nowIso();
    const r = await db.prepare(`INSERT INTO usuarios (nome, login, senha_hash, perfil, trocar_senha, criado_em, atualizado_em) VALUES (?, ?, ?, 'ADMIN', 1, ?, ?)`)
      .bind(nome.join(' '), login.toLowerCase(), await hashSenha(process.env.SENHA), now, now).run();
    await auditar('USUARIO_CRIADO', r.meta.last_row_id, { login, perfil: 'ADMIN', origem: 'cli' });
    console.log(`Administrador "${login}" criado.`);
  } else if (cmd === 'redefinir-senha') {
    const [login] = args;
    validarSenha(process.env.SENHA || '');
    const u = await db.prepare('SELECT id FROM usuarios WHERE login = ?').bind(login).first();
    if (!u) throw new Error('Usuário não encontrado.');
    await db.batch([
      db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = NULL, ativo = 1, atualizado_em = ? WHERE id = ?')
        .bind(await hashSenha(process.env.SENHA), nowIso(), u.id),
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(u.id),
    ]);
    await auditar('SENHA_REDEFINIDA', u.id, { origem: 'cli' });
    console.log('Senha redefinida.');
  } else if (cmd === 'backup') {
    const p = localParts();
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, `encomendas-${p.date}_${p.time.replace(':', '')}${p.seconds}-manual.db`);
    db.backup(destino);
    console.log(`Backup criado: ${destino}`);
  } else {
    console.log("Comandos: criar-admin <login> <nome>, redefinir-senha <login>, backup  (senha na variável de ambiente SENHA)");
  }
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
