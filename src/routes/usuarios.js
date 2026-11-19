import { nowIso } from '../lib/time.js';
import { bad, notFound, conflict, str } from '../lib/util.js';
import { auditoria, diff } from '../lib/auditoria.js';
import { hashSenha, validarSenha } from '../lib/seguranca.js';
import { requireAuth, requireAdmin, corpo } from '../app.js';

const PERFIS = ['ADMIN', 'CONTROLADOR'];
const CAMPOS_PUBLICOS = 'id, nome, login, email, perfil, ativo, trocar_senha, ultimo_login_em, bloqueado_ate, criado_em, atualizado_em';

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

export default function rotasUsuarios(app) {
  // Lista mínima para seleção (funcionário que recebeu / controlador que entregou)
  app.get('/usuarios/lista', requireAuth, async (c) => {
    const todos = c.req.query('todos') === '1';
    const { results } = await c.get('db').prepare(`SELECT id, nome, perfil, ativo FROM usuarios ${todos ? '' : 'WHERE ativo = 1'} ORDER BY nome`).all();
    return c.json(results);
  });

  app.get('/usuarios', requireAdmin, async (c) => {
    const { results } = await c.get('db').prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios ORDER BY ativo DESC, nome`).all();
    return c.json(results);
  });

  async function unico(db, campos, id = 0) {
    if (campos.login && await db.prepare('SELECT 1 x FROM usuarios WHERE login = ? AND id <> ?').bind(campos.login, id).first()) throw conflict('Já existe um usuário com este login.');
    if (campos.email && await db.prepare('SELECT 1 x FROM usuarios WHERE email = ? AND id <> ?').bind(campos.email, id).first()) throw conflict('Já existe um usuário com este e-mail.');
  }

  app.post('/usuarios', requireAdmin, async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const v = validar(b);
    validarSenha(b.senha);
    await unico(db, v);
    const now = nowIso();
    const [r] = await db.batch([
      db.prepare(`INSERT INTO usuarios (nome, login, email, senha_hash, perfil, ativo, trocar_senha, criado_em, criado_por_id, atualizado_em)
                  VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
        .bind(v.nome, v.login, v.email, await hashSenha(b.senha), v.perfil, b.trocar_senha === false ? 0 : 1, now, c.get('user').id, now),
      auditoria(db, c, { acao: 'USUARIO_CRIADO', entidade: 'usuario', entidadeIdSql: ['(SELECT id FROM usuarios WHERE login = ?)', [v.login]],
        detalhes: { nome: v.nome, login: v.login, email: v.email, perfil: v.perfil } }),
    ]);
    void r;
    return c.json(await db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE login = ?`).bind(v.login).first(), 201);
  });

  app.put('/usuarios/:id', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const antes = await db.prepare('SELECT * FROM usuarios WHERE id = ?').bind(id).first();
    if (!antes) throw notFound();
    const v = validar(await corpo(c), true);
    await unico(db, v, id);
    if (id === c.get('user').id && (v.ativo === 0 || (v.perfil && v.perfil !== 'ADMIN'))) throw bad('Você não pode desativar ou rebaixar o seu próprio usuário.');
    const depois = { ...antes, ...v };
    if (antes.perfil === 'ADMIN' && antes.ativo && (depois.perfil !== 'ADMIN' || !depois.ativo)) {
      const admins = (await db.prepare("SELECT COUNT(*) n FROM usuarios WHERE perfil = 'ADMIN' AND ativo = 1").first()).n;
      if (admins <= 1) throw bad('É necessário manter pelo menos um administrador ativo.');
    }
    const cmds = [
      db.prepare('UPDATE usuarios SET nome = ?, login = ?, email = ?, perfil = ?, ativo = ?, atualizado_em = ? WHERE id = ?')
        .bind(depois.nome, depois.login, depois.email, depois.perfil, depois.ativo, nowIso(), id),
      auditoria(db, c, { acao: 'USUARIO_EDITADO', entidade: 'usuario', entidadeId: id, detalhes: diff(antes, depois, ['nome', 'login', 'email', 'perfil', 'ativo']) }),
    ];
    if (!depois.ativo) cmds.push(db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(id));
    await db.batch(cmds);
    return c.json(await db.prepare(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?`).bind(id).first());
  });

  app.post('/usuarios/:id/redefinir-senha', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    if (!await db.prepare('SELECT 1 x FROM usuarios WHERE id = ?').bind(id).first()) throw notFound();
    const b = await corpo(c);
    validarSenha(b.senha);
    await db.batch([
      db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, tentativas_falhas = 0, bloqueado_ate = NULL, atualizado_em = ? WHERE id = ?')
        .bind(await hashSenha(b.senha), nowIso(), id),
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(id),
      auditoria(db, c, { acao: 'SENHA_REDEFINIDA', entidade: 'usuario', entidadeId: id }),
    ]);
    return c.json({ ok: true });
  });
}
