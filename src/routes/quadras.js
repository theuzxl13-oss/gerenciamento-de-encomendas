// Gerenciar quadras e lotes: cadastro, edição, pesquisa, consulta, desativação e exclusão controlada.
import { nowIso } from '../lib/time.js';
import { bad, notFound, conflict, str, text, int, likeEscape } from '../lib/util.js';
import { auditoria, diff } from '../lib/auditoria.js';
import { erroRestricao } from '../lib/config.js';
import { chaveEquivalente } from '../lib/importacao.js';
import { requireAuth, requireAdmin, corpo } from '../app.js';

export const natural = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });

// Identificação de quadra/lote: texto livre curto, preservado exatamente (zeros à esquerda inclusive).
function codigo(v, rotulo) {
  const s = str(v, 30);
  if (!s) throw bad(`Informe a identificação ${rotulo}.`);
  if (!/^[\p{L}\p{N} ._\-/]+$/u.test(s)) throw bad(`Identificação ${rotulo} contém caracteres inválidos (use letras, números, espaço, ponto, hífen ou barra).`);
  return s;
}

const MSG_LOTE_FIXO = 'Este lote possui encomendas registradas: a quadra e o número do lote não podem ser alterados para preservar o histórico. Se o cadastro está errado, desative-o e cadastre o lote correto.';
const MSG_QUADRA_FIXA = 'Esta quadra possui encomendas registradas: a identificação não pode ser alterada para preservar o histórico. Desative-a e cadastre a quadra correta.';

export default function rotasQuadras(app) {
  const quadraEquivalente = async (db, cod, id = 0) => (await db.prepare('SELECT id, codigo FROM quadras WHERE id <> ?').bind(id).all())
    .results.find((q) => chaveEquivalente(q.codigo) === chaveEquivalente(cod));
  const loteEquivalente = async (db, quadraId, cod, id = 0) => (await db.prepare('SELECT id, codigo FROM lotes WHERE quadra_id = ? AND id <> ?').bind(quadraId, id).all())
    .results.find((l) => chaveEquivalente(l.codigo) === chaveEquivalente(cod));
  const encomendasDoLote = async (db, id) => (await db.prepare('SELECT COUNT(*) n FROM encomendas WHERE lote_id = ?').bind(id).first()).n;
  const encomendasDaQuadra = async (db, id) => (await db.prepare('SELECT COUNT(*) n FROM encomendas e JOIN lotes l ON l.id = e.lote_id WHERE l.quadra_id = ?').bind(id).first()).n;

  // ---------- Quadras ----------
  app.get('/quadras', requireAuth, async (c) => {
    const { results } = await c.get('db').prepare(`
      SELECT q.*, uc.nome criado_por, ua.nome atualizado_por,
             (SELECT COUNT(*) FROM lotes l WHERE l.quadra_id = q.id) total_lotes,
             (SELECT COUNT(*) FROM lotes l WHERE l.quadra_id = q.id AND l.ativo = 1) lotes_ativos,
             (SELECT COUNT(*) FROM encomendas e JOIN lotes l ON l.id = e.lote_id WHERE l.quadra_id = q.id) total_encomendas
      FROM quadras q LEFT JOIN usuarios uc ON uc.id = q.criado_por_id LEFT JOIN usuarios ua ON ua.id = q.atualizado_por_id
      ${c.req.query('ativos') === '1' ? 'WHERE q.ativo = 1' : ''}`).all();
    results.sort((a, b) => natural(a.codigo, b.codigo));
    return c.json(results);
  });

  app.post('/quadras', requireAdmin, async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const cod = codigo(b.codigo, 'da quadra');
    const eq = await quadraEquivalente(db, cod);
    if (eq) throw conflict(`Quadra já cadastrada como "${eq.codigo}".`);
    const now = nowIso();
    const u = c.get('user').id;
    await db.batch([
      db.prepare('INSERT INTO quadras (codigo, descricao, ativo, criado_em, criado_por_id, atualizado_em, atualizado_por_id) VALUES (?, ?, 1, ?, ?, ?, ?)')
        .bind(cod, str(b.descricao, 200), now, u, now, u),
      auditoria(db, c, { acao: 'QUADRA_CRIADA', entidade: 'quadra', entidadeIdSql: ['(SELECT id FROM quadras WHERE codigo = ?)', [cod]], detalhes: { codigo: cod } }),
    ]);
    return c.json(await db.prepare('SELECT * FROM quadras WHERE codigo = ?').bind(cod).first(), 201);
  });

  app.put('/quadras/:id', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const antes = await db.prepare('SELECT * FROM quadras WHERE id = ?').bind(id).first();
    if (!antes) throw notFound('Quadra não encontrada.');
    const b = await corpo(c);
    const depois = {
      codigo: b.codigo !== undefined ? codigo(b.codigo, 'da quadra') : antes.codigo,
      descricao: b.descricao !== undefined ? str(b.descricao, 200) : antes.descricao,
      ativo: b.ativo !== undefined ? (b.ativo ? 1 : 0) : antes.ativo,
    };
    if (depois.codigo !== antes.codigo) {
      if (await encomendasDaQuadra(db, id)) throw conflict(MSG_QUADRA_FIXA);
      const eq = await quadraEquivalente(db, depois.codigo, id);
      if (eq) throw conflict(`Quadra já cadastrada como "${eq.codigo}".`);
    }
    const mud = diff(antes, depois, ['codigo', 'descricao', 'ativo']);
    if (!Object.keys(mud).length) return c.json(antes);
    try {
      await db.batch([
        db.prepare('UPDATE quadras SET codigo = ?, descricao = ?, ativo = ?, atualizado_em = ?, atualizado_por_id = ? WHERE id = ?')
          .bind(depois.codigo, depois.descricao, depois.ativo, nowIso(), c.get('user').id, id),
        auditoria(db, c, { acao: 'QUADRA_EDITADA', entidade: 'quadra', entidadeId: id, detalhes: mud }),
      ]);
    } catch (e) {
      if (erroRestricao(e, 'QUADRA_COM_ENCOMENDAS')) throw conflict(MSG_QUADRA_FIXA);
      throw e;
    }
    return c.json(await db.prepare('SELECT * FROM quadras WHERE id = ?').bind(id).first());
  });

  // Exclusão: somente quadra cujos lotes nunca tiveram encomendas (cadastro feito por engano).
  app.delete('/quadras/:id', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const q = await db.prepare('SELECT * FROM quadras WHERE id = ?').bind(id).first();
    if (!q) throw notFound('Quadra não encontrada.');
    const just = text((await corpo(c)).justificativa, 1000);
    if (!just) throw bad('Informe a justificativa da exclusão.');
    const n = await encomendasDaQuadra(db, id);
    if (n) throw conflict(`A quadra ${q.codigo} possui ${n} encomenda(s) no histórico e não pode ser excluída. Use "Desativar".`, { pode_desativar: true });
    const lotes = (await db.prepare('SELECT codigo FROM lotes WHERE quadra_id = ?').bind(id).all()).results.map((l) => l.codigo);
    try {
      await db.batch([
        db.prepare('DELETE FROM lotes WHERE quadra_id = ?').bind(id),
        db.prepare('DELETE FROM quadras WHERE id = ?').bind(id),
        auditoria(db, c, { acao: 'QUADRA_EXCLUIDA', entidade: 'quadra', entidadeId: id, justificativa: just, detalhes: { codigo: q.codigo, descricao: q.descricao, lotes_excluidos: lotes } }),
      ]);
    } catch (e) {
      if (erroRestricao(e, 'LOTE_COM_ENCOMENDAS') || erroRestricao(e, 'QUADRA_COM_LOTES')) throw conflict('A quadra passou a ter encomendas e não pode ser excluída. Use "Desativar".');
      throw e;
    }
    return c.json({ ok: true, lotes_excluidos: lotes.length });
  });

  // ---------- Lotes ----------
  app.get('/lotes', requireAuth, async (c) => {
    const where = [];
    const p = [];
    const qid = int(c.req.query('quadra_id'));
    if (qid) { where.push('l.quadra_id = ?'); p.push(qid); }
    if (c.req.query('ativos') === '1') where.push('l.ativo = 1 AND q.ativo = 1');
    if (c.req.query('situacao') === 'ativos') where.push('l.ativo = 1');
    if (c.req.query('situacao') === 'inativos') where.push('l.ativo = 0');
    const busca = c.req.query('q');
    if (busca) {
      where.push("(l.codigo LIKE ? ESCAPE '\\' OR l.endereco LIKE ? ESCAPE '\\' OR q.codigo LIKE ? ESCAPE '\\' OR (q.codigo || '/' || l.codigo) LIKE ? ESCAPE '\\')");
      const v = likeEscape(busca); p.push(v, v, v, v);
    }
    const { results } = await c.get('db').prepare(`
      SELECT l.*, q.codigo quadra_codigo, q.ativo quadra_ativa, ua.nome atualizado_por,
             (SELECT COUNT(*) FROM encomendas e WHERE e.lote_id = l.id AND e.status = 'PENDENTE') pendentes,
             (SELECT COUNT(*) FROM encomendas e WHERE e.lote_id = l.id) total_encomendas
      FROM lotes l JOIN quadras q ON q.id = l.quadra_id LEFT JOIN usuarios ua ON ua.id = l.atualizado_por_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).bind(...p).all();
    results.sort((a, b) => natural(a.quadra_codigo, b.quadra_codigo) || natural(a.codigo, b.codigo));
    return c.json(results);
  });

  // Consulta detalhada do lote: situação, encomendas e histórico de alterações do cadastro.
  app.get('/lotes/:id', requireAuth, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const l = await db.prepare(`SELECT l.*, q.codigo quadra_codigo, q.ativo quadra_ativa, uc.nome criado_por, ua.nome atualizado_por,
        (SELECT COUNT(*) FROM encomendas e WHERE e.lote_id = l.id AND e.status = 'PENDENTE') pendentes,
        (SELECT COUNT(*) FROM encomendas e WHERE e.lote_id = l.id) total_encomendas,
        (SELECT MAX(e.recebido_em) FROM encomendas e WHERE e.lote_id = l.id) ultima_encomenda_em
      FROM lotes l JOIN quadras q ON q.id = l.quadra_id LEFT JOIN usuarios uc ON uc.id = l.criado_por_id LEFT JOIN usuarios ua ON ua.id = l.atualizado_por_id
      WHERE l.id = ?`).bind(id).first();
    if (!l) throw notFound('Lote não encontrado.');
    l.alteracoes = (await db.prepare(`SELECT ocorrido_em, usuario_nome, acao, detalhes, justificativa FROM auditoria
                                      WHERE entidade = 'lote' AND entidade_id = ? ORDER BY id DESC LIMIT 50`).bind(id).all())
      .results.map((a) => ({ ...a, detalhes: a.detalhes ? JSON.parse(a.detalhes) : null }));
    return c.json(l);
  });

  app.post('/lotes', requireAdmin, async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const quadraId = int(b.quadra_id);
    const q = quadraId && await db.prepare('SELECT id, codigo FROM quadras WHERE id = ?').bind(quadraId).first();
    if (!q) throw bad('Selecione a quadra.');
    const cod = codigo(b.codigo, 'do lote');
    const eq = await loteEquivalente(db, quadraId, cod);
    if (eq) throw conflict(`O lote ${cod} já existe na quadra ${q.codigo} (cadastrado como "${eq.codigo}").`);
    const now = nowIso();
    const u = c.get('user').id;
    const endereco = str(b.endereco, 300);
    await db.batch([
      db.prepare('INSERT INTO lotes (quadra_id, codigo, endereco, observacao, ativo, criado_em, criado_por_id, atualizado_em, atualizado_por_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)')
        .bind(quadraId, cod, endereco, text(b.observacao, 500), now, u, now, u),
      auditoria(db, c, { acao: 'LOTE_CRIADO', entidade: 'lote', entidadeIdSql: ['(SELECT id FROM lotes WHERE quadra_id = ? AND codigo = ?)', [quadraId, cod]],
        detalhes: { quadra: q.codigo, lote: cod, endereco } }),
    ]);
    return c.json(await db.prepare('SELECT * FROM lotes WHERE quadra_id = ? AND codigo = ?').bind(quadraId, cod).first(), 201);
  });

  app.put('/lotes/:id', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const antes = await db.prepare('SELECT * FROM lotes WHERE id = ?').bind(id).first();
    if (!antes) throw notFound('Lote não encontrado.');
    const b = await corpo(c);
    const pick = (k, fn) => (b[k] !== undefined ? fn(b[k]) : antes[k]);
    const depois = {
      quadra_id: pick('quadra_id', int),
      codigo: pick('codigo', (v) => codigo(v, 'do lote')),
      endereco: pick('endereco', (v) => str(v, 300)),
      observacao: pick('observacao', (v) => text(v, 500)),
      ativo: pick('ativo', (v) => (v ? 1 : 0)),
    };
    const q = await db.prepare('SELECT id, codigo FROM quadras WHERE id = ?').bind(depois.quadra_id).first();
    if (!q) throw bad('Quadra inválida.');
    if (depois.codigo !== antes.codigo || depois.quadra_id !== antes.quadra_id) {
      if (await encomendasDoLote(db, id)) throw conflict(MSG_LOTE_FIXO);
      const eq = await loteEquivalente(db, depois.quadra_id, depois.codigo, id);
      if (eq) throw conflict(`O lote ${depois.codigo} já existe na quadra ${q.codigo} (cadastrado como "${eq.codigo}").`);
    }
    const mud = diff(antes, depois, ['quadra_id', 'codigo', 'endereco', 'observacao', 'ativo']);
    if (!Object.keys(mud).length) return c.json(antes);
    try {
      await db.batch([
        db.prepare('UPDATE lotes SET quadra_id = ?, codigo = ?, endereco = ?, observacao = ?, ativo = ?, atualizado_em = ?, atualizado_por_id = ? WHERE id = ?')
          .bind(depois.quadra_id, depois.codigo, depois.endereco, depois.observacao, depois.ativo, nowIso(), c.get('user').id, id),
        auditoria(db, c, { acao: 'LOTE_EDITADO', entidade: 'lote', entidadeId: id, detalhes: mud }),
      ]);
    } catch (e) {
      if (erroRestricao(e, 'LOTE_COM_ENCOMENDAS')) throw conflict(MSG_LOTE_FIXO);
      throw e;
    }
    return c.json(await db.prepare('SELECT * FROM lotes WHERE id = ?').bind(id).first());
  });

  // Exclusão: somente lote que nunca teve encomendas. Com encomendas, apenas desativação.
  app.delete('/lotes/:id', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const l = await db.prepare('SELECT l.*, q.codigo quadra_codigo FROM lotes l JOIN quadras q ON q.id = l.quadra_id WHERE l.id = ?').bind(id).first();
    if (!l) throw notFound('Lote não encontrado.');
    const just = text((await corpo(c)).justificativa, 1000);
    if (!just) throw bad('Informe a justificativa da exclusão.');
    const n = await encomendasDoLote(db, id);
    if (n) throw conflict(`O lote ${l.codigo} da quadra ${l.quadra_codigo} possui ${n} encomenda(s) no histórico e não pode ser excluído. Use "Desativar".`, { pode_desativar: true });
    try {
      await db.batch([
        db.prepare('DELETE FROM lotes WHERE id = ?').bind(id),
        auditoria(db, c, { acao: 'LOTE_EXCLUIDO', entidade: 'lote', entidadeId: id, justificativa: just,
          detalhes: { quadra: l.quadra_codigo, lote: l.codigo, endereco: l.endereco, observacao: l.observacao } }),
      ]);
    } catch (e) {
      if (erroRestricao(e, 'LOTE_COM_ENCOMENDAS')) throw conflict('O lote passou a ter encomendas e não pode ser excluído. Use "Desativar".');
      throw e;
    }
    return c.json({ ok: true });
  });
}
