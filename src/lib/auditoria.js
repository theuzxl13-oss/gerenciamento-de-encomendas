// Auditoria permanente. Retorna o comando preparado para ser executado sozinho ou dentro de um batch atômico.
import { nowIso } from './time.js';

// opcoes: { acao, entidade, entidadeId, encomendaId, detalhes, justificativa, usuario,
//           condicional (só grava se o comando anterior do batch alterou linhas),
//           entidadeIdSql / encomendaIdSql: [subconsulta, parâmetros] para ids ainda não conhecidos }
export function auditoria(db, c, o) {
  const u = o.usuario || (c && c.get('user')) || null;
  const ip = c ? ipDe(c) : null;
  const vals = [nowIso(), u ? u.id : null, u ? u.nome : null, o.acao, o.entidade];
  const partes = ['?', '?', '?', '?', '?'];
  if (o.entidadeIdSql) { partes.push(o.entidadeIdSql[0]); vals.push(...o.entidadeIdSql[1]); } else { partes.push('?'); vals.push(o.entidadeId ?? null); }
  if (o.encomendaIdSql) { partes.push(o.encomendaIdSql[0]); vals.push(...o.encomendaIdSql[1]); } else { partes.push('?'); vals.push(o.encomendaId ?? null); }
  partes.push('?', '?', '?');
  vals.push(o.detalhes ? JSON.stringify(o.detalhes) : null, o.justificativa ?? null, ip);
  const cols = 'ocorrido_em, usuario_id, usuario_nome, acao, entidade, entidade_id, encomenda_id, detalhes, justificativa, ip';
  const sql = o.condicional
    ? `INSERT INTO auditoria (${cols}) SELECT ${partes.join(', ')} WHERE changes() > 0`
    : `INSERT INTO auditoria (${cols}) VALUES (${partes.join(', ')})`;
  return db.prepare(sql).bind(...vals);
}

export function ipDe(c) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.get('ip') || null;
}

// Diferenças entre dois objetos, apenas nas chaves informadas.
export function diff(antes, depois, chaves) {
  const out = {};
  for (const k of chaves) {
    const a = antes[k] ?? null;
    const d = depois[k] ?? null;
    if (String(a) !== String(d)) out[k] = { antes: a, depois: d };
  }
  return out;
}
