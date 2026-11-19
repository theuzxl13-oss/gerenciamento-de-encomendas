// Importação da relação oficial de quadras e lotes: classificação e gravação.
// A leitura do arquivo (CSV/Excel) é feita no navegador por public/js/planilha.js; aqui os dados
// recebidos são revalidados, classificados contra o banco e gravados numa única operação atômica.
import { bad } from './util.js';

export const MAX_LINHAS = 20000;
const MAX_TAM_CODIGO = 30;

// Chave de equivalência: "01" ≡ "1", "A-01" ≡ "a-1". Usada só para detectar duplicidade, nunca para gravar.
export function chaveEquivalente(codigo) {
  return String(codigo).toUpperCase().replace(/\s+/g, '').replace(/(^|[^0-9])0+(?=\d)/g, '$1');
}

export const SITUACOES = {
  NOVO: 'Novo – será importado',
  REATIVAR: 'Existente inativo – será reativado',
  EXISTENTE: 'Já cadastrado – ignorado',
  DUPLICADO_ARQUIVO: 'Duplicado no próprio arquivo – ignorado',
  DUPLICADO_EQUIVALENTE: 'Duplicado de registro existente com grafia diferente – ignorado',
  INVALIDO: 'Inválido – ignorado',
};


// Revalida as linhas recebidas do navegador (nunca confia no cliente).
export function validarLinhas(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) throw bad('O arquivo não possui registros abaixo do cabeçalho.');
  if (linhas.length > MAX_LINHAS) throw bad(`Arquivo com mais de ${MAX_LINHAS} linhas.`);
  return linhas.map((l, i) => ({
    linha: Number.isInteger(l && l.linha) ? l.linha : i + 2,
    quadra: String((l && l.quadra) ?? '').replace(/\s+/g, ' ').trim(),
    lote: String((l && l.lote) ?? '').replace(/\s+/g, ' ').trim(),
    numerico_excel: !!(l && l.numerico_excel),
  }));
}

export async function carregarBase(db) {
  const [q, l] = await db.batch([
    db.prepare('SELECT id, codigo, ativo FROM quadras'),
    db.prepare('SELECT id, codigo, ativo, quadra_id FROM lotes'),
  ]);
  return { quadras: q.results, lotes: l.results };
}

// Classifica cada linha em relação ao banco. Não grava nada.
export function analisar({ quadras, lotes }, linhas) {
  const qExata = new Map(quadras.map((q) => [q.codigo, q]));
  const qEquiv = new Map(quadras.map((q) => [chaveEquivalente(q.codigo), q]));
  const lExato = new Map(lotes.map((l) => [`${l.quadra_id}|${l.codigo}`, l]));
  const lEquiv = new Map(lotes.map((l) => [`${l.quadra_id}|${chaveEquivalente(l.codigo)}`, l]));
  const vistos = new Map();
  const registros = [];
  const novasQuadras = new Set();
  const lotesNoArquivo = new Set();

  for (const r of linhas) {
    const reg = { linha: r.linha, quadra: r.quadra, lote: r.lote, situacao: null, detalhe: null };
    registros.push(reg);
    if (!r.quadra || !r.lote) { reg.situacao = 'INVALIDO'; reg.detalhe = !r.quadra ? 'Quadra vazia' : 'Lote vazio'; continue; }
    if (r.quadra.length > MAX_TAM_CODIGO || r.lote.length > MAX_TAM_CODIGO) { reg.situacao = 'INVALIDO'; reg.detalhe = 'Identificação muito longa'; continue; }
    if (/[\u0000-\u001f]/.test(r.quadra + r.lote)) { reg.situacao = 'INVALIDO'; reg.detalhe = 'Caracteres inválidos'; continue; }
    const chave = `${chaveEquivalente(r.quadra)}|${chaveEquivalente(r.lote)}`;
    if (vistos.has(chave)) {
      reg.situacao = 'DUPLICADO_ARQUIVO';
      const o = vistos.get(chave);
      reg.detalhe = `Mesmo registro da linha ${o.linha} (Quadra ${o.quadra}, Lote ${o.lote})`;
      continue;
    }
    vistos.set(chave, r);
    if (r.numerico_excel) reg.aviso = 'Célula numérica no Excel: confira se há zeros à esquerda';

    let quadra = qExata.get(r.quadra);
    if (!quadra) {
      const eq = qEquiv.get(chaveEquivalente(r.quadra));
      if (eq) {
        reg.situacao = 'DUPLICADO_EQUIVALENTE';
        reg.detalhe = `Já existe a quadra "${eq.codigo}" (equivalente a "${r.quadra}")`;
        continue;
      }
      novasQuadras.add(r.quadra);
      reg.situacao = 'NOVO';
      reg.quadra_nova = true;
      continue;
    }
    const lote = lExato.get(`${quadra.id}|${r.lote}`);
    if (lote) {
      lotesNoArquivo.add(lote.id);
      if (lote.ativo && quadra.ativo) { reg.situacao = 'EXISTENTE'; continue; }
      reg.situacao = 'REATIVAR';
      reg._lote_id = lote.id;
      if (!quadra.ativo) reg._quadra_id = quadra.id;
      reg.detalhe = !quadra.ativo ? 'Quadra e lote serão reativados' : 'Lote será reativado';
      continue;
    }
    const eqL = lEquiv.get(`${quadra.id}|${chaveEquivalente(r.lote)}`);
    if (eqL) {
      lotesNoArquivo.add(eqL.id);
      reg.situacao = 'DUPLICADO_EQUIVALENTE';
      reg.detalhe = `Já existe o lote "${eqL.codigo}" na quadra ${quadra.codigo} (equivalente a "${r.lote}")`;
      continue;
    }
    reg.situacao = 'NOVO';
  }

  const ausentes = lotes.filter((l) => l.ativo && !lotesNoArquivo.has(l.id));
  const conta = (s) => registros.filter((r) => r.situacao === s).length;
  const resumo = {
    total_linhas: registros.length,
    novos: conta('NOVO'),
    reativados: conta('REATIVAR'),
    ja_existentes: conta('EXISTENTE'),
    duplicados_arquivo: conta('DUPLICADO_ARQUIVO'),
    duplicados_equivalentes: conta('DUPLICADO_EQUIVALENTE'),
    invalidos: conta('INVALIDO'),
    quadras_novas: novasQuadras.size,
    lotes_ausentes_no_arquivo: ausentes.length,
  };
  // Conferência das quadras do arquivo: faixa numérica e lacunas na sequência.
  const quadrasArquivo = [...new Set(registros.filter((r) => r.situacao !== 'INVALIDO').map((r) => r.quadra))];
  const numericas = quadrasArquivo.filter((q) => /^\d+$/.test(q)).map(Number);
  const conferencia = { total_quadras: quadrasArquivo.length, quadras_nao_numericas: quadrasArquivo.filter((q) => !/^\d+$/.test(q)) };
  if (numericas.length) {
    const min = Math.min(...numericas); const max = Math.max(...numericas);
    const presentes = new Set(numericas);
    const largura = Math.max(...quadrasArquivo.filter((q) => /^\d+$/.test(q)).map((q) => q.length));
    const faltantes = [];
    for (let i = min; i <= max && faltantes.length < 500; i++) if (!presentes.has(i)) faltantes.push(String(i).padStart(Math.min(largura, 2), '0'));
    Object.assign(conferencia, { primeira: String(min).padStart(Math.min(largura, 2), '0'), ultima: String(max), faltantes_na_sequencia: faltantes });
  }
  const existentesQ = new Set(quadras.map((q) => q.codigo));
  conferencia.quadras_novas_lista = quadrasArquivo.filter((q) => !existentesQ.has(q) && !qEquiv.has(chaveEquivalente(q)));
  conferencia.lotes_por_quadra_nova = Object.fromEntries(conferencia.quadras_novas_lista.map((q) => [q, registros.filter((r) => r.quadra === q && r.situacao === 'NOVO').length]));
  conferencia.base_atual = { quadras: quadras.length, lotes: lotes.length, lotes_ativos: lotes.filter((l) => l.ativo).length };
  conferencia.base_apos = { lotes: lotes.length + conta('NOVO') };
  conferencia.quadras_com_novos_lotes = [...new Set(registros.filter((r) => r.situacao === 'NOVO').map((r) => r.quadra))];
  resumo.importados = resumo.novos + resumo.reativados;
  resumo.ignorados = resumo.ja_existentes + resumo.invalidos;
  resumo.duplicados = resumo.duplicados_arquivo + resumo.duplicados_equivalentes;
  return { resumo, registros, ausentes, conferencia };
}


// Divide em blocos respeitando o limite de 100 parâmetros por comando do D1.
function blocos(lista, tamanho) {
  const out = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

// Monta os comandos de gravação (executados num único batch atômico pela rota).
export function comandosAplicar(db, { registros, ausentes, desativarAusentes, now, usuarioId }) {
  const cmds = [];
  const novos = registros.filter((r) => r.situacao === 'NOVO');
  const reativar = registros.filter((r) => r.situacao === 'REATIVAR');
  const quadrasNovas = [...new Set(novos.filter((r) => r.quadra_nova).map((r) => r.quadra))];
  for (const b of blocos(quadrasNovas, 90)) {
    cmds.push(db.prepare(`INSERT INTO quadras (codigo, ativo, criado_em, criado_por_id, atualizado_em, atualizado_por_id)
                          SELECT column1, 1, ?, ?, ?, ? FROM (VALUES ${b.map(() => '(?)').join(', ')})`)
      .bind(now, usuarioId, now, usuarioId, ...b));
  }
  const quadrasReativar = [...new Set(reativar.map((r) => r._quadra_id).filter(Boolean))];
  for (const b of blocos(quadrasReativar, 90)) {
    cmds.push(db.prepare(`UPDATE quadras SET ativo = 1, atualizado_em = ?, atualizado_por_id = ? WHERE id IN (${b.map(() => '?').join(', ')})`)
      .bind(now, usuarioId, ...b));
  }
  for (const b of blocos(novos, 45)) {
    cmds.push(db.prepare(`INSERT INTO lotes (quadra_id, codigo, ativo, criado_em, criado_por_id, atualizado_em, atualizado_por_id)
                          SELECT q.id, v.column2, 1, ?, ?, ?, ? FROM (VALUES ${b.map(() => '(?, ?)').join(', ')}) v
                          JOIN quadras q ON q.codigo = v.column1`)
      .bind(now, usuarioId, now, usuarioId, ...b.flatMap((r) => [r.quadra, r.lote])));
  }
  for (const b of blocos(reativar.map((r) => r._lote_id), 90)) {
    cmds.push(db.prepare(`UPDATE lotes SET ativo = 1, atualizado_em = ?, atualizado_por_id = ? WHERE id IN (${b.map(() => '?').join(', ')})`)
      .bind(now, usuarioId, ...b));
  }
  let desativados = 0;
  if (desativarAusentes) {
    for (const b of blocos(ausentes.map((l) => l.id), 90)) {
      cmds.push(db.prepare(`UPDATE lotes SET ativo = 0, atualizado_em = ?, atualizado_por_id = ? WHERE id IN (${b.map(() => '?').join(', ')})`)
        .bind(now, usuarioId, ...b));
      desativados += b.length;
    }
  }
  return { cmds, desativados };
}

// Remove campos internos antes de responder ao navegador.
export const registroPublico = ({ _lote_id, _quadra_id, ...r }) => r;
