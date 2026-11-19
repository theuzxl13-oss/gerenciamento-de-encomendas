// Construção da consulta de encomendas com todos os filtros (usada na pesquisa, histórico e relatórios).
import { todayLocal, addDays, daysBetween, isDate } from './time.js';
import { int, likeEscape } from './util.js';

export const STATUS = ['PENDENTE', 'RETIRADA', 'RETIRADA_OUTRO_PLANTAO', 'CANCELADA'];

export const SELECT_BASE = `
SELECT e.id, e.codigo, e.recebido_em, e.recebido_data, e.descricao, e.endereco_complementar, e.codigo_rastreio,
       e.observacoes, e.status, e.cadastrado_em, e.atualizado_em, e.lote_id,
       l.codigo lote, l.endereco lote_endereco, q.id quadra_id, q.codigo quadra,
       t.id transportadora_id, t.nome transportadora,
       e.recebido_por_id, ur.nome recebido_por,
       e.cadastrado_por_id, uc.nome cadastrado_por,
       r.id retirada_id, r.tipo retirada_tipo, r.retirado_em, r.data_local retirada_data, r.hora_local retirada_hora,
       r.retirado_por_nome, r.documento_retirante, r.entregue_por_id, COALESCE(ue.nome, r.entregue_por_nome) entregue_por,
       r.entregador_desconhecido, r.plantao, r.observacoes retirada_observacoes, r.lancado_em retirada_lancada_em,
       r.lancado_por_id, ul.nome lancado_por,
       e.motivo_cancelamento, e.cancelado_em
FROM encomendas e
JOIN lotes l ON l.id = e.lote_id
JOIN quadras q ON q.id = l.quadra_id
JOIN transportadoras t ON t.id = e.transportadora_id
JOIN usuarios ur ON ur.id = e.recebido_por_id
JOIN usuarios uc ON uc.id = e.cadastrado_por_id
LEFT JOIN retiradas r ON r.encomenda_id = e.id AND r.estornada_em IS NULL
LEFT JOIN usuarios ue ON ue.id = r.entregue_por_id
LEFT JOIN usuarios ul ON ul.id = r.lancado_por_id`;

// f: objeto com filtros (geralmente req.query)
export function montarFiltros(f) {
  const where = [];
  const p = [];
  const like = (v) => likeEscape(v);

  const status = []
    .concat(f.status || [])
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim().toUpperCase())
    .filter((s) => STATUS.includes(s));
  if (status.length) { where.push(`e.status IN (${status.map(() => '?').join(',')})`); p.push(...status); }
  else if (f.incluir_canceladas !== '1') where.push("e.status <> 'CANCELADA'");

  if (int(f.quadra_id)) { where.push('q.id = ?'); p.push(int(f.quadra_id)); }
  if (int(f.lote_id)) { where.push('l.id = ?'); p.push(int(f.lote_id)); }
  if (f.quadra && !int(f.quadra_id)) { where.push('q.codigo = ?'); p.push(String(f.quadra).trim()); }
  if (f.lote && !int(f.lote_id)) { where.push('l.codigo = ?'); p.push(String(f.lote).trim()); }
  if (int(f.transportadora_id)) { where.push('t.id = ?'); p.push(int(f.transportadora_id)); }
  if (int(f.recebido_por_id)) { where.push('e.recebido_por_id = ?'); p.push(int(f.recebido_por_id)); }
  if (int(f.entregue_por_id)) { where.push('r.entregue_por_id = ?'); p.push(int(f.entregue_por_id)); }
  if (int(f.lancado_por_id)) { where.push('r.lancado_por_id = ?'); p.push(int(f.lancado_por_id)); }
  // "controlador": recebeu, entregou ou lançou
  if (int(f.controlador_id)) {
    where.push('(e.recebido_por_id = ? OR r.entregue_por_id = ? OR r.lancado_por_id = ?)');
    const c = int(f.controlador_id); p.push(c, c, c);
  }
  if (f.descricao) { where.push("e.descricao LIKE ? ESCAPE '\\'"); p.push(like(f.descricao)); }
  if (f.retirado_por) { where.push("r.retirado_por_nome LIKE ? ESCAPE '\\'"); p.push(like(f.retirado_por)); }
  if (f.entregue_por) { where.push("COALESCE(ue.nome, r.entregue_por_nome) LIKE ? ESCAPE '\\'"); p.push(like(f.entregue_por)); }
  if (f.recebido_por) { where.push("ur.nome LIKE ? ESCAPE '\\'"); p.push(like(f.recebido_por)); }
  if (f.plantao) { where.push("r.plantao LIKE ? ESCAPE '\\'"); p.push(like(f.plantao)); }
  if (f.codigo) { where.push("e.codigo LIKE ? ESCAPE '\\'"); p.push(like(f.codigo)); }
  if (f.q) {
    // busca geral
    where.push(`(e.codigo LIKE ? ESCAPE '\\' OR e.descricao LIKE ? ESCAPE '\\' OR e.codigo_rastreio LIKE ? ESCAPE '\\'
                 OR e.endereco_complementar LIKE ? ESCAPE '\\' OR e.observacoes LIKE ? ESCAPE '\\' OR t.nome LIKE ? ESCAPE '\\'
                 OR r.retirado_por_nome LIKE ? ESCAPE '\\' OR l.endereco LIKE ? ESCAPE '\\')`);
    const v = like(f.q); p.push(v, v, v, v, v, v, v, v);
  }
  // Período de recebimento
  if (isDate(f.data_ini)) { where.push('e.recebido_data >= ?'); p.push(f.data_ini); }
  if (isDate(f.data_fim)) { where.push('e.recebido_data <= ?'); p.push(f.data_fim); }
  // Período de retirada
  if (isDate(f.retirada_ini)) { where.push('r.data_local >= ?'); p.push(f.retirada_ini); }
  if (isDate(f.retirada_fim)) { where.push('r.data_local <= ?'); p.push(f.retirada_fim); }
  if (f.tipo_retirada === 'PROPRIA' || f.tipo_retirada === 'OUTRO_PLANTAO') { where.push('r.tipo = ?'); p.push(f.tipo_retirada); }

  // Tempo de espera (somente pendentes fazem sentido, mas o filtro é por data de recebimento)
  const hoje = todayLocal();
  const dmin = int(f.dias_min);
  const dmax = int(f.dias_max);
  if (dmin !== null && dmin >= 0) { where.push('e.recebido_data <= ?'); p.push(addDays(hoje, -dmin)); }
  if (dmax !== null && dmax >= 0) { where.push('e.recebido_data >= ?'); p.push(addDays(hoje, -dmax)); }

  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params: p };
}

const ORDENS = {
  recebido_desc: 'e.recebido_em DESC, e.id DESC',
  recebido_asc: 'e.recebido_em ASC, e.id ASC',
  retirada_desc: 'r.data_local DESC, r.hora_local DESC, e.id DESC',
  quadra: 'q.codigo COLLATE NOCASE, CAST(l.codigo AS INTEGER), l.codigo, e.recebido_em',
};

export function enriquecer(row, hoje = todayLocal()) {
  if (!row) return row;
  row.dias_espera = row.status === 'PENDENTE'
    ? daysBetween(row.recebido_data, hoje)
    : (row.retirada_data ? daysBetween(row.recebido_data, row.retirada_data) : null);
  return row;
}

export async function buscar(db, f, { limiteMax = 500 } = {}) {
  const { where, params } = montarFiltros(f);
  const ordem = ORDENS[f.ordem] || ORDENS.recebido_desc;
  const total = (await db.prepare(`SELECT COUNT(*) n FROM (${SELECT_BASE} ${where})`).bind(...params).first()).n;
  const por = Math.min(Math.max(int(f.por_pagina) || 25, 1), limiteMax);
  const pagina = Math.max(int(f.pagina) || 1, 1);
  const hoje = todayLocal();
  const { results } = await db.prepare(`${SELECT_BASE} ${where} ORDER BY ${ordem} LIMIT ? OFFSET ?`)
    .bind(...params, por, (pagina - 1) * por).all();
  return { total, pagina, por_pagina: por, itens: results.map((r) => enriquecer(r, hoje)) };
}

export async function carregarEncomenda(db, id) {
  return enriquecer(await db.prepare(`${SELECT_BASE} WHERE e.id = ?`).bind(id).first());
}
