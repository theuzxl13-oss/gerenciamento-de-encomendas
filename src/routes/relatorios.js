// Relatórios: o servidor entrega dados e totais (consultas SQL leves); os arquivos PDF/Excel são
// gerados no navegador, o que mantém cada requisição dentro dos limites do plano gratuito da Cloudflare.
import { fmtDate, isDate } from '../lib/time.js';
import { str, int } from '../lib/util.js';
import { auditoria } from '../lib/auditoria.js';
import { SELECT_BASE, montarFiltros, buscar } from '../lib/consulta.js';
import { requireAuth, corpo } from '../app.js';

export const STATUS_LABEL = {
  PENDENTE: 'Aguardando retirada',
  RETIRADA: 'Retirada',
  RETIRADA_OUTRO_PLANTAO: 'Retirada realizada por outro plantão',
  CANCELADA: 'Cancelada',
};

function descreverFiltros(f, nomes) {
  const out = [];
  if (f.data_ini || f.data_fim) out.push(`Recebimento: ${f.data_ini ? fmtDate(f.data_ini) : '...'} a ${f.data_fim ? fmtDate(f.data_fim) : '...'}`);
  if (f.retirada_ini || f.retirada_fim) out.push(`Retirada: ${f.retirada_ini ? fmtDate(f.retirada_ini) : '...'} a ${f.retirada_fim ? fmtDate(f.retirada_fim) : '...'}`);
  if (f.status) out.push(`Situação: ${String(f.status).split(',').map((s) => STATUS_LABEL[s] || s).join(', ')}`);
  if (nomes.quadra) out.push(`Quadra: ${nomes.quadra}`);
  if (nomes.lote) out.push(`Lote: ${nomes.lote}`);
  if (nomes.transportadora) out.push(`Transportadora: ${nomes.transportadora}`);
  if (nomes.controlador) out.push(`Controlador: ${nomes.controlador}`);
  if (f.tipo_retirada === 'OUTRO_PLANTAO') out.push('Somente retiradas por outro plantão');
  if (f.tipo_retirada === 'PROPRIA') out.push('Somente retiradas próprias');
  if (f.q) out.push(`Busca: "${f.q}"`);
  return out.length ? out.join(' · ') : 'Sem filtros (todas as encomendas)';
}

export default function rotasRelatorios(app) {
  app.get('/relatorios', requireAuth, async (c) => {
    const db = c.get('db');
    const f = c.req.query();
    const nomes = {};
    if (int(f.quadra_id)) nomes.quadra = (await db.prepare('SELECT codigo FROM quadras WHERE id = ?').bind(int(f.quadra_id)).first())?.codigo;
    if (int(f.lote_id)) nomes.lote = (await db.prepare('SELECT codigo FROM lotes WHERE id = ?').bind(int(f.lote_id)).first())?.codigo;
    if (int(f.transportadora_id)) nomes.transportadora = (await db.prepare('SELECT nome FROM transportadoras WHERE id = ?').bind(int(f.transportadora_id)).first())?.nome;
    if (int(f.controlador_id)) nomes.controlador = (await db.prepare('SELECT nome FROM usuarios WHERE id = ?').bind(int(f.controlador_id)).first())?.nome;
    const { where, params } = montarFiltros(f);
    const [st, tr] = await db.batch([
      db.prepare(`SELECT status, COUNT(*) n FROM (${SELECT_BASE} ${where}) GROUP BY status`).bind(...params),
      db.prepare(`SELECT transportadora nome, COUNT(*) n FROM (${SELECT_BASE} ${where}) GROUP BY transportadora ORDER BY n DESC`).bind(...params),
    ]);
    const lista = await buscar(db, { ...f, ordem: f.ordem || 'recebido_asc', por_pagina: int(f.por_pagina) || 200, pagina: f.pagina || 1 });
    const ordemStatus = Object.keys(STATUS_LABEL);
    return c.json({
      filtros: descreverFiltros(f, nomes),
      total: lista.total,
      resumo: {
        total: lista.total,
        por_status: st.results.sort((a, b) => ordemStatus.indexOf(a.status) - ordemStatus.indexOf(b.status)).map((s) => ({ ...s, rotulo: STATUS_LABEL[s.status] })),
        por_transportadora: tr.results,
      },
      pagina: lista.pagina,
      por_pagina: lista.por_pagina,
      itens: lista.itens,
    });
  });

  // Registro na auditoria das exportações feitas no navegador.
  app.post('/relatorios/exportacao', requireAuth, async (c) => {
    const b = await corpo(c);
    await auditoria(c.get('db'), c, { acao: 'RELATORIO_EXPORTADO', entidade: 'relatorio',
      detalhes: { formato: str(b.formato, 10), tipo: str(b.tipo, 30) || 'encomendas', filtros: str(b.filtros, 500), total: int(b.total) } }).run();
    return c.json({ ok: true });
  });

  app.get('/relatorios/funcionarios', requireAuth, async (c) => {
    const f = c.req.query();
    const ini = isDate(f.data_ini) ? f.data_ini : '0000-01-01';
    const fim = isDate(f.data_fim) ? f.data_fim : '9999-12-31';
    const { results } = await c.get('db').prepare(`
      SELECT u.id, u.nome, u.perfil, u.ativo,
        (SELECT COUNT(*) FROM encomendas e WHERE e.recebido_por_id = u.id AND e.status <> 'CANCELADA' AND e.recebido_data BETWEEN ? AND ?) recebidas,
        (SELECT COUNT(*) FROM encomendas e WHERE e.cadastrado_por_id = u.id AND e.status <> 'CANCELADA' AND e.recebido_data BETWEEN ? AND ?) cadastradas,
        (SELECT COUNT(*) FROM retiradas r WHERE r.estornada_em IS NULL AND r.tipo = 'PROPRIA' AND r.entregue_por_id = u.id AND r.data_local BETWEEN ? AND ?) entregas,
        (SELECT COUNT(*) FROM retiradas r WHERE r.estornada_em IS NULL AND r.tipo = 'OUTRO_PLANTAO' AND r.entregue_por_id = u.id AND r.data_local BETWEEN ? AND ?) entregas_informadas_outro_plantao,
        (SELECT COUNT(*) FROM retiradas r WHERE r.estornada_em IS NULL AND r.tipo = 'OUTRO_PLANTAO' AND r.lancado_por_id = u.id AND r.data_local BETWEEN ? AND ?) lancamentos_outro_plantao
      FROM usuarios u ORDER BY u.nome`).bind(ini, fim, ini, fim, ini, fim, ini, fim, ini, fim).all();
    const linhas = results.filter((l) => l.ativo || l.recebidas || l.cadastradas || l.entregas || l.entregas_informadas_outro_plantao || l.lancamentos_outro_plantao);
    return c.json({ periodo: `${f.data_ini ? fmtDate(f.data_ini) : 'início'} a ${f.data_fim ? fmtDate(f.data_fim) : 'hoje'}`, linhas });
  });
}
