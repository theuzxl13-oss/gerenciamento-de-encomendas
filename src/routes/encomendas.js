import { nowIso, localParts, localToUtc, isDate, isTime, todayLocal } from '../lib/time.js';
import { bad, forbidden, notFound, conflict, str, text, int } from '../lib/util.js';
import { auditoria, diff } from '../lib/auditoria.js';
import { getConfig, erroRestricao } from '../lib/config.js';
import { buscar, carregarEncomenda } from '../lib/consulta.js';
import { requireAuth, requireAdmin, corpo } from '../app.js';

const CAMPOS_EDITAVEIS = ['recebido_em', 'lote_id', 'descricao', 'endereco_complementar', 'transportadora_id', 'codigo_rastreio', 'recebido_por_id', 'observacoes'];

// Data/hora local informada → instante UTC; valida que não está no futuro.
function instante(data, hora, rotulo) {
  if (!isDate(data)) throw bad(`Data de ${rotulo} inválida.`);
  if (!isTime(hora)) throw bad(`Horário de ${rotulo} inválido.`);
  const dt = localToUtc(data, hora);
  if (dt.getTime() > Date.now() + 5 * 60000) throw bad(`A data/horário de ${rotulo} não pode estar no futuro.`);
  return dt;
}

function podeEditar(u, enc) {
  if (enc.status === 'CANCELADA') return false;
  if (u.perfil === 'ADMIN') return true;
  return enc.status === 'PENDENTE' && enc.cadastrado_por_id === u.id && Date.now() - new Date(enc.cadastrado_em).getTime() < 24 * 3600 * 1000;
}

export default function rotasEncomendas(app) {
  const loteAtivo = (db, id) => db.prepare(`SELECT l.id FROM lotes l JOIN quadras q ON q.id = l.quadra_id WHERE l.id = ? AND l.ativo = 1 AND q.ativo = 1`).bind(id).first();
  const transpAtiva = (db, id) => db.prepare('SELECT id FROM transportadoras WHERE id = ? AND ativo = 1').bind(id).first();
  const usuarioAtivo = (db, id) => db.prepare('SELECT id, nome FROM usuarios WHERE id = ? AND ativo = 1').bind(id).first();
  const carregar = async (db, id) => {
    const e = await carregarEncomenda(db, id);
    if (!e) throw notFound('Encomenda não encontrada.');
    return e;
  };

  // ---------- Pesquisa / histórico ----------
  app.get('/encomendas', requireAuth, async (c) => c.json(await buscar(c.get('db'), c.req.query())));

  // ---------- Ficha completa ----------
  app.get('/encomendas/:id', requireAuth, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const enc = await carregar(db, id);
    const [ret, anx, alt] = await db.batch([
      db.prepare(`SELECT r.*, COALESCE(ue.nome, r.entregue_por_nome) entregue_por, ul.nome lancado_por, us.nome estornada_por
                  FROM retiradas r LEFT JOIN usuarios ue ON ue.id = r.entregue_por_id
                  LEFT JOIN usuarios ul ON ul.id = r.lancado_por_id LEFT JOIN usuarios us ON us.id = r.estornada_por_id
                  WHERE r.encomenda_id = ? ORDER BY r.id`).bind(id),
      db.prepare(`SELECT a.id, a.tipo, a.nome_original, a.mime, a.tamanho, a.descricao, a.retirada_id, a.enviado_em, a.removido_em, a.motivo_remocao,
                         u.nome enviado_por, ur.nome removido_por
                  FROM anexos a JOIN usuarios u ON u.id = a.enviado_por_id LEFT JOIN usuarios ur ON ur.id = a.removido_por_id
                  WHERE a.encomenda_id = ? ORDER BY a.id`).bind(id),
      db.prepare('SELECT id, ocorrido_em, usuario_nome, acao, detalhes, justificativa FROM auditoria WHERE encomenda_id = ? ORDER BY id').bind(id),
    ]);
    enc.retiradas = ret.results;
    enc.anexos = anx.results;
    enc.alteracoes = alt.results.map((a) => ({ ...a, detalhes: a.detalhes ? JSON.parse(a.detalhes) : null }));
    const u = c.get('user');
    enc.permissoes = {
      editar: podeEditar(u, enc),
      retirar: enc.status === 'PENDENTE',
      cancelar: u.perfil === 'ADMIN' && enc.status === 'PENDENTE',
      corrigir_retirada: u.perfil === 'ADMIN' && !!enc.retirada_id,
      estornar: u.perfil === 'ADMIN' && !!enc.retirada_id,
      remover_anexo: u.perfil === 'ADMIN',
    };
    return c.json(enc);
  });

  // ---------- Cadastro ----------
  app.post('/encomendas', requireAuth, async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const user = c.get('user');
    const agora = localParts();
    const data = b.data || agora.date;
    const hora = b.hora || agora.time;
    const recebidoEm = instante(data, hora, 'recebimento');
    const loteId = int(b.lote_id);
    if (!loteId || !await loteAtivo(db, loteId)) throw bad('Selecione uma quadra e um lote da relação oficial.');
    const descricao = str(b.descricao, 300);
    if (!descricao) throw bad('Informe a descrição da encomenda.');
    const transpId = int(b.transportadora_id);
    if (!transpId || !await transpAtiva(db, transpId)) throw bad('Selecione a transportadora.');
    const recebidoPor = int(b.recebido_por_id) || user.id;
    if (!await usuarioAtivo(db, recebidoPor)) throw bad('Funcionário que recebeu inválido.');

    // Identificador único: contador anual incrementado atomicamente.
    const nome = `FI-${data.slice(0, 4)}`;
    const v = await db.prepare('INSERT INTO contadores (nome, valor) VALUES (?, 1) ON CONFLICT(nome) DO UPDATE SET valor = valor + 1 RETURNING valor').bind(nome).first();
    const codigo = `${nome}-${String(v.valor).padStart(5, '0')}`;
    const now = nowIso();
    await db.batch([
      db.prepare(`INSERT INTO encomendas (codigo, recebido_em, recebido_data, lote_id, descricao, endereco_complementar, transportadora_id,
                    codigo_rastreio, recebido_por_id, observacoes, status, cadastrado_por_id, cadastrado_em, atualizado_em)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?, ?, ?)`)
        .bind(codigo, recebidoEm.toISOString(), data, loteId, descricao, str(b.endereco_complementar, 300), transpId,
          str(b.codigo_rastreio, 80), recebidoPor, text(b.observacoes), user.id, now, now),
      auditoria(db, c, {
        acao: 'ENCOMENDA_CADASTRADA', entidade: 'encomenda',
        entidadeIdSql: ['(SELECT id FROM encomendas WHERE codigo = ?)', [codigo]], encomendaIdSql: ['(SELECT id FROM encomendas WHERE codigo = ?)', [codigo]],
        detalhes: { codigo, recebido_em: recebidoEm.toISOString(), lote_id: loteId, descricao, transportadora_id: transpId, recebido_por_id: recebidoPor },
      }),
    ]);
    const { id } = await db.prepare('SELECT id FROM encomendas WHERE codigo = ?').bind(codigo).first();
    return c.json(await carregar(db, id), 201);
  });

  // ---------- Edição justificada ----------
  app.put('/encomendas/:id', requireAuth, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const antes = await db.prepare('SELECT * FROM encomendas WHERE id = ?').bind(id).first();
    if (!antes) throw notFound('Encomenda não encontrada.');
    const enc = await carregar(db, id);
    const user = c.get('user');
    if (!podeEditar(user, enc)) {
      throw forbidden(user.perfil === 'ADMIN' ? 'Encomenda cancelada não pode ser editada.'
        : 'Controladores só podem corrigir encomendas pendentes que cadastraram nas últimas 24 horas. Solicite ao administrador.');
    }
    const b = await corpo(c);
    const justificativa = text(b.justificativa, 1000);
    if (!justificativa) throw bad('Informe a justificativa da correção.');
    const depois = { ...antes };
    if (b.data !== undefined || b.hora !== undefined) {
      const atual = localParts(new Date(antes.recebido_em));
      depois.recebido_em = instante(b.data || atual.date, b.hora || atual.time, 'recebimento').toISOString();
      depois.recebido_data = b.data || atual.date;
    }
    if (b.lote_id !== undefined) {
      depois.lote_id = int(b.lote_id);
      if (depois.lote_id !== antes.lote_id && !await loteAtivo(db, depois.lote_id)) throw bad('Lote inválido ou inativo.');
    }
    if (b.descricao !== undefined) { depois.descricao = str(b.descricao, 300); if (!depois.descricao) throw bad('Informe a descrição.'); }
    if (b.endereco_complementar !== undefined) depois.endereco_complementar = str(b.endereco_complementar, 300);
    if (b.transportadora_id !== undefined) {
      depois.transportadora_id = int(b.transportadora_id);
      if (depois.transportadora_id !== antes.transportadora_id && !await transpAtiva(db, depois.transportadora_id)) throw bad('Transportadora inválida.');
    }
    if (b.codigo_rastreio !== undefined) depois.codigo_rastreio = str(b.codigo_rastreio, 80);
    if (b.recebido_por_id !== undefined) {
      depois.recebido_por_id = int(b.recebido_por_id);
      if (depois.recebido_por_id !== antes.recebido_por_id && !await usuarioAtivo(db, depois.recebido_por_id)) throw bad('Funcionário inválido.');
    }
    if (b.observacoes !== undefined) depois.observacoes = text(b.observacoes);
    const mud = diff(antes, depois, CAMPOS_EDITAVEIS);
    if (!Object.keys(mud).length) throw bad('Nenhuma alteração informada.');
    await db.batch([
      db.prepare(`UPDATE encomendas SET recebido_em = ?, recebido_data = ?, lote_id = ?, descricao = ?, endereco_complementar = ?, transportadora_id = ?,
                    codigo_rastreio = ?, recebido_por_id = ?, observacoes = ?, atualizado_em = ?, atualizado_por_id = ? WHERE id = ?`)
        .bind(depois.recebido_em, depois.recebido_data, depois.lote_id, depois.descricao, depois.endereco_complementar, depois.transportadora_id,
          depois.codigo_rastreio, depois.recebido_por_id, depois.observacoes, nowIso(), user.id, id),
      auditoria(db, c, { acao: 'ENCOMENDA_EDITADA', entidade: 'encomenda', entidadeId: id, encomendaId: id, detalhes: mud, justificativa }),
    ]);
    return c.json(await carregar(db, id));
  });

  // ---------- Cancelamento lógico (admin) ----------
  app.post('/encomendas/:id/cancelar', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const motivo = text((await corpo(c)).motivo, 1000);
    if (!motivo) throw bad('Informe o motivo do cancelamento.');
    const u = c.get('user').id;
    const [up] = await db.batch([
      db.prepare(`UPDATE encomendas SET status = 'CANCELADA', cancelado_em = ?, cancelado_por_id = ?, motivo_cancelamento = ?,
                    atualizado_em = ?, atualizado_por_id = ? WHERE id = ? AND status = 'PENDENTE'`).bind(nowIso(), u, motivo, nowIso(), u, id),
      auditoria(db, c, { acao: 'ENCOMENDA_CANCELADA', entidade: 'encomenda', entidadeId: id, encomendaId: id, justificativa: motivo, condicional: true }),
    ]);
    if (!up.meta.changes) throw conflict('Somente encomendas pendentes podem ser canceladas (estorne a retirada antes, se necessário).');
    return c.json(await carregar(db, id));
  });

  // ---------- Retiradas ----------
  async function dadosRetirada(db, b, tipo, cfg, user) {
    const out = { tipo };
    out.retirado_por_nome = str(b.retirado_por_nome, 160);
    if (!out.retirado_por_nome) throw bad('Informe o nome de quem retirou.');
    out.documento_retirante = str(b.documento_retirante, 40);
    out.observacoes = text(b.observacoes, 2000);
    out.plantao = str(b.plantao, 60);
    out.justificativa_horario = text(b.justificativa_horario, 1000);
    if (tipo === 'PROPRIA') {
      const agora = localParts();
      out.data_local = b.data || agora.date;
      out.hora_local = b.hora || agora.time;
      const dt = instante(out.data_local, out.hora_local, 'retirada');
      out.retirado_em = dt.toISOString();
      const tolerancia = (cfg.minutos_tolerancia_horario || 15) * 60000;
      if (Math.abs(dt.getTime() - Date.now()) > tolerancia && !out.justificativa_horario) {
        throw bad('A data/horário informado difere do horário atual. Informe a justificativa da correção.', { campo: 'justificativa_horario' });
      }
      out.entregue_por_id = int(b.entregue_por_id) || user.id;
      if (!await usuarioAtivo(db, out.entregue_por_id)) throw bad('Controlador que entregou inválido.');
      out.entregue_por_nome = null;
      out.entregador_desconhecido = 0;
    } else {
      // Retirada realizada por outro plantão (lançada posteriormente)
      if (!isDate(b.data)) throw bad('Informe a data da retirada.');
      out.data_local = b.data;
      out.hora_local = b.hora ? b.hora : null;
      if (out.hora_local && !isTime(out.hora_local)) throw bad('Horário inválido.');
      if (out.hora_local) out.retirado_em = instante(out.data_local, out.hora_local, 'retirada').toISOString();
      else {
        if (out.data_local > todayLocal()) throw bad('A data da retirada não pode estar no futuro.');
        out.retirado_em = null;
      }
      out.entregador_desconhecido = b.entregador_desconhecido ? 1 : 0;
      out.entregue_por_id = out.entregador_desconhecido ? null : int(b.entregue_por_id);
      out.entregue_por_nome = out.entregador_desconhecido || out.entregue_por_id ? null : str(b.entregue_por_nome, 120);
      if (!out.entregador_desconhecido && !out.entregue_por_id && !out.entregue_por_nome) {
        throw bad('Informe o controlador que entregou ou marque "não sei quem entregou".');
      }
      if (out.entregue_por_id === user.id) {
        throw bad('Na retirada por outro plantão, o controlador que entregou não pode ser você. Se você mesmo entregou, use "Registrar retirada".');
      }
      if (out.entregue_por_id && !await db.prepare('SELECT 1 x FROM usuarios WHERE id = ?').bind(out.entregue_por_id).first()) throw bad('Controlador inválido.');
      if (!out.plantao) throw bad('Informe o plantão em que a retirada ocorreu.');
      if (!out.observacoes) throw bad('A observação é obrigatória na retirada por outro plantão.');
    }
    return out;
  }

  async function mensagemJaRetirada(db, enc) {
    if (enc.status === 'CANCELADA') return `A encomenda ${enc.codigo} está cancelada.`;
    const ret = await db.prepare(`SELECT r.data_local, r.hora_local, r.retirado_por_nome, u.nome lancado_por FROM retiradas r
                                  JOIN usuarios u ON u.id = r.lancado_por_id WHERE r.encomenda_id = ? AND r.estornada_em IS NULL`).bind(enc.id).first();
    const det = ret ? ` em ${ret.data_local.split('-').reverse().join('/')}${ret.hora_local ? ' ' + ret.hora_local : ''} por ${ret.retirado_por_nome} (lançado por ${ret.lancado_por})` : '';
    return `A encomenda ${enc.codigo} já foi retirada${det}. Baixa duplicada bloqueada.`;
  }

  app.post('/retiradas', requireAuth, async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const user = c.get('user');
    const tipo = b.tipo === 'OUTRO_PLANTAO' ? 'OUTRO_PLANTAO' : 'PROPRIA';
    const ids = [...new Set([].concat(b.encomenda_ids || b.encomenda_id || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw bad('Selecione ao menos uma encomenda.');
    if (ids.length > 30) throw bad('Máximo de 30 encomendas por baixa.');
    const d = await dadosRetirada(db, b, tipo, await getConfig(db), user);
    const novoStatus = tipo === 'PROPRIA' ? 'RETIRADA' : 'RETIRADA_OUTRO_PLANTAO';
    const encs = (await db.prepare(`SELECT id, codigo, status, recebido_data FROM encomendas WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
    for (const id of ids) {
      const enc = encs.find((e) => e.id === id);
      if (!enc) throw notFound(`Encomenda ${id} não encontrada.`);
      if (enc.status !== 'PENDENTE') throw conflict(await mensagemJaRetirada(db, enc), { encomenda_id: id });
      if (d.data_local < enc.recebido_data) throw bad(`A data da retirada não pode ser anterior ao recebimento da encomenda ${enc.codigo}.`);
    }
    // Uma única transação: o trigger do banco recusa baixa de encomenda que não está pendente e o índice único
    // impede duas retiradas ativas — mesmo com dois computadores confirmando ao mesmo tempo.
    const now = nowIso();
    const cmds = [];
    for (const id of ids) {
      const enc = encs.find((e) => e.id === id);
      cmds.push(db.prepare(`INSERT INTO retiradas (encomenda_id, tipo, retirado_em, data_local, hora_local, retirado_por_nome, documento_retirante,
                              entregue_por_id, entregue_por_nome, entregador_desconhecido, plantao, observacoes, justificativa_horario, lancado_por_id, lancado_em)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, tipo, d.retirado_em, d.data_local, d.hora_local, d.retirado_por_nome, d.documento_retirante,
          d.entregue_por_id, d.entregue_por_nome, d.entregador_desconhecido, d.plantao, d.observacoes, d.justificativa_horario, user.id, now));
      cmds.push(db.prepare("UPDATE encomendas SET status = ?, atualizado_em = ?, atualizado_por_id = ? WHERE id = ? AND status = 'PENDENTE'").bind(novoStatus, now, user.id, id));
      cmds.push(auditoria(db, c, {
        acao: tipo === 'PROPRIA' ? 'RETIRADA_REGISTRADA' : 'RETIRADA_OUTRO_PLANTAO_REGISTRADA', entidade: 'retirada',
        entidadeIdSql: ['(SELECT id FROM retiradas WHERE encomenda_id = ? AND estornada_em IS NULL)', [id]], encomendaId: id,
        detalhes: {
          codigo: enc.codigo, data: d.data_local, hora: d.hora_local, retirado_por: d.retirado_por_nome,
          entregue_por_id: d.entregue_por_id, entregue_por_nome: d.entregue_por_nome, entregador_desconhecido: !!d.entregador_desconhecido,
          plantao: d.plantao, lancado_por_id: user.id, lote_com: ids.length > 1 ? ids : undefined,
        },
        justificativa: d.justificativa_horario,
      }));
    }
    try {
      await db.batch(cmds);
    } catch (e) {
      if (erroRestricao(e, 'ENCOMENDA_NAO_PENDENTE') || erroRestricao(e, 'UNIQUE')) {
        const atual = (await db.prepare(`SELECT id, codigo, status FROM encomendas WHERE id IN (${ids.map(() => '?').join(',')}) AND status <> 'PENDENTE'`).bind(...ids).all()).results;
        throw conflict(atual.length ? await mensagemJaRetirada(db, atual[0]) : 'Encomenda já baixada por outro usuário. Baixa duplicada bloqueada.');
      }
      throw e;
    }
    const criadas = (await db.prepare(`SELECT r.encomenda_id, r.id retirada_id, e.codigo FROM retiradas r JOIN encomendas e ON e.id = r.encomenda_id
                                       WHERE r.encomenda_id IN (${ids.map(() => '?').join(',')}) AND r.estornada_em IS NULL`).bind(...ids).all()).results;
    return c.json({ ok: true, retiradas: criadas }, 201);
  });

  // Correção justificada de retirada (admin)
  app.put('/retiradas/:id', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const antes = await db.prepare('SELECT * FROM retiradas WHERE id = ? AND estornada_em IS NULL').bind(id).first();
    if (!antes) throw notFound('Retirada não encontrada ou estornada.');
    const b = await corpo(c);
    const justificativa = text(b.justificativa, 1000);
    if (!justificativa) throw bad('Informe a justificativa da correção.');
    const depois = { ...antes };
    if (b.data !== undefined) { if (!isDate(b.data)) throw bad('Data inválida.'); depois.data_local = b.data; }
    if (b.hora !== undefined) { if (b.hora && !isTime(b.hora)) throw bad('Horário inválido.'); depois.hora_local = b.hora || null; }
    if (antes.tipo === 'PROPRIA' && !depois.hora_local) throw bad('Retirada própria exige horário.');
    depois.retirado_em = depois.hora_local ? instante(depois.data_local, depois.hora_local, 'retirada').toISOString() : null;
    const enc = await db.prepare('SELECT recebido_data FROM encomendas WHERE id = ?').bind(antes.encomenda_id).first();
    if (depois.data_local < enc.recebido_data) throw bad('A retirada não pode ser anterior ao recebimento.');
    if (b.retirado_por_nome !== undefined) { depois.retirado_por_nome = str(b.retirado_por_nome, 160); if (!depois.retirado_por_nome) throw bad('Informe quem retirou.'); }
    if (b.documento_retirante !== undefined) depois.documento_retirante = str(b.documento_retirante, 40);
    if (b.plantao !== undefined) depois.plantao = str(b.plantao, 60);
    if (b.observacoes !== undefined) depois.observacoes = text(b.observacoes, 2000);
    if (b.entregue_por_id !== undefined || b.entregue_por_nome !== undefined || b.entregador_desconhecido !== undefined) {
      depois.entregador_desconhecido = b.entregador_desconhecido ? 1 : 0;
      depois.entregue_por_id = depois.entregador_desconhecido ? null : int(b.entregue_por_id);
      depois.entregue_por_nome = depois.entregador_desconhecido || depois.entregue_por_id ? null : str(b.entregue_por_nome, 120);
      if (antes.tipo === 'PROPRIA' && !depois.entregue_por_id) throw bad('Informe o controlador que entregou.');
    }
    if (antes.tipo === 'OUTRO_PLANTAO' && (!depois.plantao || !depois.observacoes)) throw bad('Plantão e observação são obrigatórios.');
    const mud = diff(antes, depois, ['data_local', 'hora_local', 'retirado_por_nome', 'documento_retirante', 'entregue_por_id', 'entregue_por_nome', 'entregador_desconhecido', 'plantao', 'observacoes']);
    if (!Object.keys(mud).length) throw bad('Nenhuma alteração informada.');
    await db.batch([
      db.prepare(`UPDATE retiradas SET data_local = ?, hora_local = ?, retirado_em = ?, retirado_por_nome = ?, documento_retirante = ?, entregue_por_id = ?,
                    entregue_por_nome = ?, entregador_desconhecido = ?, plantao = ?, observacoes = ? WHERE id = ?`)
        .bind(depois.data_local, depois.hora_local, depois.retirado_em, depois.retirado_por_nome, depois.documento_retirante, depois.entregue_por_id,
          depois.entregue_por_nome, depois.entregador_desconhecido, depois.plantao, depois.observacoes, id),
      db.prepare('UPDATE encomendas SET atualizado_em = ?, atualizado_por_id = ? WHERE id = ?').bind(nowIso(), c.get('user').id, antes.encomenda_id),
      auditoria(db, c, { acao: 'RETIRADA_CORRIGIDA', entidade: 'retirada', entidadeId: id, encomendaId: antes.encomenda_id, detalhes: mud, justificativa }),
    ]);
    return c.json(await carregar(db, antes.encomenda_id));
  });

  // Estorno de baixa feita por engano (admin): a retirada é preservada como estornada e a encomenda volta a pendente.
  app.post('/retiradas/:id/estornar', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const motivo = text((await corpo(c)).motivo, 1000);
    if (!motivo) throw bad('Informe o motivo do estorno.');
    const ret = await db.prepare('SELECT * FROM retiradas WHERE id = ? AND estornada_em IS NULL').bind(id).first();
    if (!ret) throw notFound('Retirada não encontrada ou já estornada.');
    const u = c.get('user').id;
    await db.batch([
      db.prepare('UPDATE retiradas SET estornada_em = ?, estornada_por_id = ?, motivo_estorno = ? WHERE id = ? AND estornada_em IS NULL').bind(nowIso(), u, motivo, id),
      db.prepare("UPDATE encomendas SET status = 'PENDENTE', atualizado_em = ?, atualizado_por_id = ? WHERE id = ?").bind(nowIso(), u, ret.encomenda_id),
      auditoria(db, c, { acao: 'RETIRADA_ESTORNADA', entidade: 'retirada', entidadeId: id, encomendaId: ret.encomenda_id, justificativa: motivo,
        detalhes: { tipo: ret.tipo, data: ret.data_local, hora: ret.hora_local, retirado_por: ret.retirado_por_nome } }),
    ]);
    return c.json(await carregar(db, ret.encomenda_id));
  });
}
