// Dashboard, transportadoras, configurações, auditoria e backups.
import { nowIso, todayLocal, addDays, localToUtc, isDate } from '../lib/time.js';
import { bad, notFound, conflict, str, int, likeEscape } from '../lib/util.js';
import { auditoria, diff } from '../lib/auditoria.js';
import { getConfig, CONFIG_PADRAO } from '../lib/config.js';
import { buscar } from '../lib/consulta.js';
import { requireAuth, requireAdmin, corpo } from '../app.js';

export default function rotasGeral(app) {
  // ---------- Dashboard ----------
  app.get('/dashboard', requireAuth, async (c) => {
    const db = c.get('db');
    const hoje = todayLocal();
    const cfg = await getConfig(db);
    const ini = localToUtc(hoje, '00:00').toISOString();
    const fim = localToUtc(addDays(hoje, 1), '00:00').toISOString();
    const [r] = await db.batch([db.prepare(`SELECT
      (SELECT COUNT(*) FROM encomendas WHERE status <> 'CANCELADA') total_recebido,
      (SELECT COUNT(*) FROM encomendas WHERE status = 'PENDENTE') pendentes,
      (SELECT COUNT(*) FROM encomendas WHERE recebido_data = ? AND status <> 'CANCELADA') recebidas_hoje,
      (SELECT COUNT(*) FROM retiradas WHERE estornada_em IS NULL AND tipo = 'PROPRIA' AND data_local = ?) retiradas_hoje,
      (SELECT COUNT(*) FROM retiradas WHERE estornada_em IS NULL AND tipo = 'OUTRO_PLANTAO' AND lancado_em >= ? AND lancado_em < ?) outro_plantao_hoje,
      (SELECT COUNT(*) FROM retiradas WHERE estornada_em IS NULL AND tipo = 'OUTRO_PLANTAO') outro_plantao_total,
      (SELECT COUNT(*) FROM encomendas WHERE status = 'PENDENTE' AND recebido_data <= ?) pendentes_alerta,
      (SELECT COUNT(*) FROM encomendas WHERE status = 'PENDENTE' AND recebido_data <= ?) pendentes_criticas,
      (SELECT COUNT(*) FROM lotes WHERE ativo = 1) lotes_cadastrados`)
      .bind(hoje, hoje, ini, fim, addDays(hoje, -cfg.dias_alerta), addDays(hoje, -cfg.dias_critico))]);
    const recentes = (await buscar(db, { por_pagina: 10, incluir_canceladas: '1' })).itens;
    const antigas = (await buscar(db, { status: 'PENDENTE', ordem: 'recebido_asc', por_pagina: 5 })).itens;
    return c.json({ hoje, indicadores: r.results[0], recentes, antigas, config: { dias_alerta: cfg.dias_alerta, dias_critico: cfg.dias_critico } });
  });

  // ---------- Transportadoras ----------
  app.get('/transportadoras', requireAuth, async (c) => {
    const { results } = await c.get('db').prepare(`SELECT t.*, (SELECT COUNT(*) FROM encomendas e WHERE e.transportadora_id = t.id) uso
                         FROM transportadoras t ${c.req.query('todas') === '1' ? '' : 'WHERE ativo = 1'} ORDER BY ordem, nome`).all();
    return c.json(results);
  });
  app.post('/transportadoras', requireAuth, async (c) => {
    const db = c.get('db');
    const nome = str((await corpo(c)).nome, 80);
    if (!nome) throw bad('Informe o nome da transportadora.');
    const ex = await db.prepare('SELECT * FROM transportadoras WHERE nome = ?').bind(nome).first();
    if (ex) {
      if (ex.ativo) throw conflict('Transportadora já cadastrada.');
      await db.batch([
        db.prepare('UPDATE transportadoras SET ativo = 1 WHERE id = ?').bind(ex.id),
        auditoria(db, c, { acao: 'TRANSPORTADORA_REATIVADA', entidade: 'transportadora', entidadeId: ex.id, detalhes: { nome } }),
      ]);
      return c.json({ ...ex, ativo: 1 }, 201);
    }
    await db.batch([
      db.prepare('INSERT INTO transportadoras (nome, ativo, ordem, criado_em, criado_por_id) VALUES (?, 1, 100, ?, ?)').bind(nome, nowIso(), c.get('user').id),
      auditoria(db, c, { acao: 'TRANSPORTADORA_CRIADA', entidade: 'transportadora', entidadeIdSql: ['(SELECT id FROM transportadoras WHERE nome = ?)', [nome]], detalhes: { nome } }),
    ]);
    return c.json(await db.prepare('SELECT * FROM transportadoras WHERE nome = ?').bind(nome).first(), 201);
  });
  app.put('/transportadoras/:id', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const antes = await db.prepare('SELECT * FROM transportadoras WHERE id = ?').bind(id).first();
    if (!antes) throw notFound();
    const b = await corpo(c);
    const depois = {
      nome: b.nome !== undefined ? str(b.nome, 80) : antes.nome,
      ativo: b.ativo !== undefined ? (b.ativo ? 1 : 0) : antes.ativo,
      ordem: b.ordem !== undefined ? (int(b.ordem) ?? antes.ordem) : antes.ordem,
    };
    if (!depois.nome) throw bad('Informe o nome.');
    if (await db.prepare('SELECT 1 x FROM transportadoras WHERE nome = ? AND id <> ?').bind(depois.nome, id).first()) throw conflict('Nome já utilizado.');
    await db.batch([
      db.prepare('UPDATE transportadoras SET nome = ?, ativo = ?, ordem = ? WHERE id = ?').bind(depois.nome, depois.ativo, depois.ordem, id),
      auditoria(db, c, { acao: 'TRANSPORTADORA_EDITADA', entidade: 'transportadora', entidadeId: id, detalhes: diff(antes, depois, ['nome', 'ativo', 'ordem']) }),
    ]);
    return c.json(await db.prepare('SELECT * FROM transportadoras WHERE id = ?').bind(id).first());
  });

  // ---------- Configurações ----------
  app.get('/configuracoes', requireAuth, async (c) => c.json({ ...(await getConfig(c.get('db'))), ambiente: c.get('ambiente'), armazenamento: c.get('arq').tipo }));
  app.put('/configuracoes', requireAdmin, async (c) => {
    const db = c.get('db');
    const antes = await getConfig(db);
    const b = await corpo(c);
    const novo = { ...antes };
    if (b.plantoes !== undefined) {
      if (!Array.isArray(b.plantoes)) throw bad('Plantões inválidos.');
      novo.plantoes = [...new Set(b.plantoes.map((p) => str(p, 60)).filter(Boolean))];
    }
    for (const k of ['dias_alerta', 'dias_critico', 'backup_retencao_dias', 'minutos_tolerancia_horario']) {
      if (b[k] !== undefined) {
        const n = int(b[k]);
        if (n === null || n < 1 || n > 3650) throw bad(`Valor inválido para ${k}.`);
        novo[k] = n;
      }
    }
    if (b.backup_automatico !== undefined) novo.backup_automatico = !!b.backup_automatico;
    if (novo.dias_critico < novo.dias_alerta) throw bad('Os dias para "crítico" devem ser maiores ou iguais aos de "alerta".');
    const cmds = Object.keys(CONFIG_PADRAO).map((k) => db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').bind(k, JSON.stringify(novo[k])));
    const mud = {};
    for (const k of Object.keys(CONFIG_PADRAO)) if (JSON.stringify(antes[k]) !== JSON.stringify(novo[k])) mud[k] = { antes: antes[k], depois: novo[k] };
    if (Object.keys(mud).length) cmds.push(auditoria(db, c, { acao: 'CONFIGURACOES_ALTERADAS', entidade: 'configuracao', detalhes: mud }));
    await db.batch(cmds);
    return c.json(await getConfig(db));
  });

  // ---------- Auditoria (admin) ----------
  app.get('/auditoria', requireAdmin, async (c) => {
    const db = c.get('db');
    const f = c.req.query();
    const where = [];
    const p = [];
    if (isDate(f.data_ini)) { where.push('a.ocorrido_em >= ?'); p.push(localToUtc(f.data_ini, '00:00').toISOString()); }
    if (isDate(f.data_fim)) { where.push('a.ocorrido_em < ?'); p.push(localToUtc(addDays(f.data_fim, 1), '00:00').toISOString()); }
    if (int(f.usuario_id)) { where.push('a.usuario_id = ?'); p.push(int(f.usuario_id)); }
    if (f.acao) { where.push('a.acao = ?'); p.push(String(f.acao)); }
    if (f.entidade) { where.push('a.entidade = ?'); p.push(String(f.entidade)); }
    if (int(f.entidade_id)) { where.push('a.entidade_id = ?'); p.push(int(f.entidade_id)); }
    if (int(f.encomenda_id)) { where.push('a.encomenda_id = ?'); p.push(int(f.encomenda_id)); }
    if (f.q) { where.push("(a.detalhes LIKE ? ESCAPE '\\' OR a.justificativa LIKE ? ESCAPE '\\' OR e.codigo LIKE ? ESCAPE '\\')"); const v = likeEscape(f.q); p.push(v, v, v); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const por = Math.min(int(f.por_pagina) || 50, 200);
    const pagina = Math.max(int(f.pagina) || 1, 1);
    const [t, it, ac] = await db.batch([
      db.prepare(`SELECT COUNT(*) n FROM auditoria a LEFT JOIN encomendas e ON e.id = a.encomenda_id ${w}`).bind(...p),
      db.prepare(`SELECT a.*, e.codigo encomenda_codigo FROM auditoria a LEFT JOIN encomendas e ON e.id = a.encomenda_id ${w}
                  ORDER BY a.id DESC LIMIT ? OFFSET ?`).bind(...p, por, (pagina - 1) * por),
      db.prepare('SELECT DISTINCT acao FROM auditoria ORDER BY acao'),
    ]);
    return c.json({
      total: t.results[0].n, pagina, por_pagina: por,
      itens: it.results.map((a) => ({ ...a, detalhes: a.detalhes ? JSON.parse(a.detalhes) : null })),
      acoes: ac.results.map((x) => x.acao),
    });
  });

  // ---------- Backups ----------
  // No servidor próprio (Node) há backups em arquivo. No Cloudflare D1 a recuperação é feita pelo Time Travel
  // e por exportação com o wrangler (ver README).
  app.get('/backups', requireAdmin, async (c) => {
    const B = c.env && c.env.BACKUP;
    if (!B) return c.json({ suportado: false, itens: [] });
    return c.json({ suportado: true, itens: B.listar() });
  });
  app.post('/backups', requireAdmin, async (c) => {
    const B = c.env && c.env.BACKUP;
    if (!B) throw bad('Neste ambiente o backup é feito pela própria Cloudflare (D1 Time Travel). Veja as instruções em Configurações.');
    const r = B.criar('manual');
    await auditoria(c.get('db'), c, { acao: 'BACKUP_CRIADO', entidade: 'backup', detalhes: r }).run();
    return c.json(r, 201);
  });
  app.get('/backups/:nome', requireAdmin, async (c) => {
    const B = c.env && c.env.BACKUP;
    const arquivo = B && B.ler(c.req.param('nome'));
    if (!arquivo) throw notFound();
    await auditoria(c.get('db'), c, { acao: 'BACKUP_BAIXADO', entidade: 'backup', detalhes: { nome: arquivo.nome } }).run();
    return new Response(arquivo.corpo, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${arquivo.nome}"` } });
  });
}
