// Importação da relação oficial de quadras e lotes (somente administrador).
// O navegador lê o arquivo (CSV/Excel) e envia as linhas; o servidor revalida, classifica e grava.
import { nowIso, localParts } from '../lib/time.js';
import { bad, conflict, str } from '../lib/util.js';
import { auditoria } from '../lib/auditoria.js';
import { sha256Hex } from '../lib/seguranca.js';
import * as I from '../lib/importacao.js';
import { requireAdmin, corpo } from '../app.js';

// Token da prévia: amarra a confirmação exatamente aos mesmos dados conferidos.
const tokenPrevia = (hashArquivo, linhas) => sha256Hex(`${hashArquivo}|${JSON.stringify(linhas.map((l) => [l.linha, l.quadra, l.lote]))}`);

export default function rotasImportacao(app) {
  app.post('/quadras-lotes/importar/previa', requireAdmin, async (c) => {
    const db = c.get('db');
    const b = await corpo(c);
    const linhas = I.validarLinhas(b.linhas);
    const hashArquivo = str(b.arquivo_sha256, 64);
    if (!hashArquivo || !/^[0-9a-f]{64}$/.test(hashArquivo)) throw bad('Identificação do arquivo ausente.');
    const { resumo, registros, conferencia } = I.analisar(await I.carregarBase(db), linhas);
    return c.json({
      arquivo: str(b.arquivo_nome, 200),
      hash: hashArquivo,
      token: await tokenPrevia(hashArquivo, linhas),
      colunas_ignoradas: Array.isArray(b.colunas_ignoradas) ? b.colunas_ignoradas.slice(0, 50).map((x) => str(x, 60)) : [],
      resumo,
      conferencia,
      registros: registros.map(I.registroPublico),
      situacoes: I.SITUACOES,
    });
  });

  // Confirmação (multipart): campo "dados" (JSON igual ao da prévia + token) e, opcionalmente, o arquivo original.
  app.post('/quadras-lotes/importar', requireAdmin, async (c) => {
    const db = c.get('db');
    const form = await c.req.parseBody();
    let b;
    try { b = JSON.parse(String(form.dados || '')); } catch { throw bad('Gere a prévia antes de importar.'); }
    if (!b.token) throw bad('Gere a prévia antes de importar.');
    const linhas = I.validarLinhas(b.linhas);
    const hashArquivo = str(b.arquivo_sha256, 64);
    if (b.token !== await tokenPrevia(hashArquivo, linhas)) throw conflict('Os dados enviados são diferentes da prévia. Gere a prévia novamente.');
    const user = c.get('user');
    const arquivoNome = str(b.arquivo_nome, 200);
    const desativarAusentes = b.desativar_ausentes === true;

    // Guarda o arquivo original (se enviado e conferido pelo hash) para rastreabilidade.
    let salvo = null;
    const f = form.arquivo;
    if (f && typeof f === 'object' && typeof f.arrayBuffer === 'function') {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const arq = c.get('arq');
      if (await sha256Hex(bytes) === hashArquivo && bytes.byteLength <= arq.limiteBytes) {
        const p = localParts();
        const ext = (arquivoNome || '').toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
        salvo = `importacoes/${p.date}_${p.time.replace(':', '')}${p.seconds}_${hashArquivo.slice(0, 12)}.${ext}`;
        await arq.put(salvo, bytes, ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv');
      }
    }

    const now = nowIso();
    const analise = I.analisar(await I.carregarBase(db), linhas);
    const { cmds, desativados } = I.comandosAplicar(db, { ...analise, desativarAusentes, now, usuarioId: user.id });
    const resumo = { ...analise.resumo, desativados };
    const problemas = analise.registros.filter((x) => ['DUPLICADO_ARQUIVO', 'DUPLICADO_EQUIVALENTE', 'INVALIDO'].includes(x.situacao))
      .slice(0, 2000).map(({ linha, quadra, lote, situacao, detalhe }) => ({ linha, quadra, lote, situacao, detalhe }));
    // Tudo numa única transação: quadras, lotes, histórico da importação e auditoria.
    cmds.push(db.prepare(`INSERT INTO importacoes (realizada_em, usuario_id, usuario_nome, arquivo_nome, arquivo_sha256, arquivo_salvo, total_linhas,
                            importados, reativados, ignorados, duplicados, invalidos, quadras_novas, desativados, detalhes)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(now, user.id, user.nome, arquivoNome, hashArquivo, salvo, resumo.total_linhas, resumo.importados, resumo.reativados,
        resumo.ignorados, resumo.duplicados, resumo.invalidos, resumo.quadras_novas, desativados,
        JSON.stringify({ resumo, conferencia: analise.conferencia, colunas_ignoradas: b.colunas_ignoradas || [], problemas })));
    cmds.push(auditoria(db, c, { acao: 'QUADRAS_LOTES_IMPORTADOS', entidade: 'importacao',
      entidadeIdSql: ['(SELECT MAX(id) FROM importacoes WHERE arquivo_sha256 = ?)', [hashArquivo]],
      detalhes: { arquivo: arquivoNome, sha256: hashArquivo, ...resumo, desativar_ausentes: desativarAusentes } }));
    await db.batch(cmds);
    const id = (await db.prepare('SELECT MAX(id) id FROM importacoes WHERE arquivo_sha256 = ? AND realizada_em = ?').bind(hashArquivo, now).first()).id;
    return c.json({ importacao_id: id, realizada_em: now, usuario: user.nome, ...resumo }, 201);
  });

  app.get('/quadras-lotes/importacoes', requireAdmin, async (c) => {
    const { results } = await c.get('db').prepare(`SELECT id, realizada_em, usuario_nome, arquivo_nome, arquivo_sha256, total_linhas, importados, reativados, ignorados,
                                duplicados, invalidos, quadras_novas, desativados FROM importacoes ORDER BY id DESC LIMIT 100`).all();
    return c.json(results);
  });

  app.get('/quadras-lotes/importacoes/:id', requireAdmin, async (c) => {
    const row = await c.get('db').prepare('SELECT * FROM importacoes WHERE id = ?').bind(Number(c.req.param('id'))).first();
    if (!row) throw bad('Importação não encontrada.');
    return c.json({ ...row, detalhes: row.detalhes ? JSON.parse(row.detalhes) : null });
  });
}
