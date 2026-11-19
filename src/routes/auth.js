import { nowIso } from '../lib/time.js';
import { HttpError, bad, str } from '../lib/util.js';
import { auditoria } from '../lib/auditoria.js';
import { hashSenha, verificarSenha, validarSenha } from '../lib/seguranca.js';
import { criarSessao, cookieSessao, requireAuth, corpo } from '../app.js';

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;

export default function rotasAuth(app) {
  const totalUsuarios = async (db) => (await db.prepare('SELECT COUNT(*) n FROM usuarios').first()).n;

  // Primeiro acesso: só permite criar o administrador inicial se o banco não tem usuários.
  app.get('/setup', async (c) => c.json({ precisa_configurar: (await totalUsuarios(c.get('db'))) === 0 }));

  app.post('/setup', async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const nome = str(b.nome, 120);
    const login = str(b.login, 60);
    const email = str(b.email, 160);
    if (!nome || !login) throw bad('Informe nome e usuário.');
    validarSenha(b.senha);
    const now = nowIso();
    // INSERT condicional: atômico mesmo com dois acessos simultâneos.
    const r = await db.prepare(`INSERT INTO usuarios (nome, login, email, senha_hash, perfil, criado_em, atualizado_em)
                                SELECT ?, ?, ?, ?, 'ADMIN', ?, ? WHERE NOT EXISTS (SELECT 1 FROM usuarios)`)
      .bind(nome, login.toLowerCase(), email, await hashSenha(b.senha), now, now).run();
    if (!r.meta.changes) throw new HttpError(409, 'O sistema já foi configurado.');
    const u = await db.prepare('SELECT id, nome FROM usuarios WHERE login = ?').bind(login.toLowerCase()).first();
    await auditoria(db, c, { acao: 'CONFIGURACAO_INICIAL', entidade: 'usuario', entidadeId: u.id, usuario: u, detalhes: { login, perfil: 'ADMIN' } }).run();
    await criarSessao(c, u.id);
    return c.json({ ok: true }, 201);
  });

  app.post('/auth/login', async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const login = str(b.login, 160);
    const senha = typeof b.senha === 'string' ? b.senha : '';
    if (!login || !senha) throw bad('Informe usuário e senha.');
    const u = await db.prepare('SELECT * FROM usuarios WHERE login = ? OR email = ?').bind(login, login).first();
    if (!u) throw new HttpError(401, 'Usuário ou senha inválidos.');
    if (u.bloqueado_ate && u.bloqueado_ate > nowIso()) {
      throw new HttpError(423, 'Usuário temporariamente bloqueado por excesso de tentativas. Aguarde 15 minutos ou procure o administrador.');
    }
    if (!(await verificarSenha(senha, u.senha_hash))) {
      const tent = u.tentativas_falhas + 1;
      const bloquear = tent >= MAX_TENTATIVAS;
      await db.batch([
        db.prepare('UPDATE usuarios SET tentativas_falhas = ?, bloqueado_ate = ? WHERE id = ?')
          .bind(bloquear ? 0 : tent, bloquear ? new Date(Date.now() + BLOQUEIO_MS).toISOString() : null, u.id),
        auditoria(db, c, { acao: bloquear ? 'LOGIN_BLOQUEADO' : 'LOGIN_FALHOU', entidade: 'usuario', entidadeId: u.id, usuario: { id: u.id, nome: u.nome } }),
      ]);
      throw new HttpError(401, 'Usuário ou senha inválidos.');
    }
    if (!u.ativo) throw new HttpError(403, 'Usuário desativado. Procure o administrador.');
    await db.batch([
      db.prepare('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login_em = ? WHERE id = ?').bind(nowIso(), u.id),
      db.prepare('DELETE FROM sessoes WHERE expira_em < ?').bind(nowIso()),
      auditoria(db, c, { acao: 'LOGIN', entidade: 'usuario', entidadeId: u.id, usuario: { id: u.id, nome: u.nome } }),
    ]);
    await criarSessao(c, u.id);
    return c.json({ ok: true });
  });

  app.post('/auth/logout', async (c) => {
    const db = c.get('db');
    if (c.get('sessionId')) {
      await db.batch([
        db.prepare('DELETE FROM sessoes WHERE id = ?').bind(c.get('sessionId')),
        auditoria(db, c, { acao: 'LOGOUT', entidade: 'usuario', entidadeId: c.get('user').id }),
      ]);
    }
    cookieSessao(c, '', 0);
    return c.json({ ok: true });
  });

  app.get('/auth/me', requireAuth, (c) => c.json(c.get('user')));

  app.post('/auth/senha', requireAuth, async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').bind(c.get('user').id).first();
    if (!(await verificarSenha(String(b.senha_atual || ''), u.senha_hash))) throw bad('Senha atual incorreta.');
    validarSenha(b.nova_senha);
    await db.batch([
      db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, atualizado_em = ? WHERE id = ?').bind(await hashSenha(b.nova_senha), nowIso(), u.id),
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND id <> ?').bind(u.id, c.get('sessionId')),
      auditoria(db, c, { acao: 'SENHA_ALTERADA', entidade: 'usuario', entidadeId: u.id }),
    ]);
    return c.json({ ok: true });
  });
}
