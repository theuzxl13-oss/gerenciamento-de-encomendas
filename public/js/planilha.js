// Leitura de planilhas da relação oficial de quadras e lotes (CSV ou Excel), feita no navegador.
// Módulo puro: também é usado pelos testes automatizados no Node.js.
// Regras: só as colunas Quadra e Lote; texto preservado exatamente (zeros à esquerda).

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function parseCsv(txt) {
  txt = String(txt).replace(/^﻿/, '');
  const primeira = txt.split(/\r?\n/, 1)[0];
  const n = (re) => (primeira.match(re) || []).length;
  const sep = n(/;/g) > n(/,/g) ? ';' : n(/\t/g) > n(/,/g) ? '\t' : ',';
  const linhas = [];
  let campo = ''; let linha = []; let aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) {
      if (ch === '"' && txt[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') aspas = false; else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && txt[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return { matriz: linhas, numericas: new Set() };
}

// Texto da célula do Excel como exibido (respeita formatos como "00", que mostram zeros à esquerda).
function textoCelula(cell, numericas, linha) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    const fmt = cell.numFmt || '';
    if (/^0+$/.test(fmt)) return String(v).padStart(fmt.length, '0');
    numericas.add(linha);
    return String(v);
  }
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return String(v.result ?? '');
    if ('text' in v) return String(v.text);
  }
  return String(v);
}

// workbook: ExcelJS.Workbook já carregado
export function matrizDeExcel(workbook) {
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error('A planilha não possui abas.');
  const matriz = [];
  const numericas = new Set();
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals = [];
    for (let c = 1; c <= Math.max(row.cellCount, 2); c++) vals.push(textoCelula(row.getCell(c), numericas, n));
    matriz[n - 1] = vals;
  });
  return { matriz, numericas };
}

// Extrai {linha, quadra, lote, numerico_excel} a partir do cabeçalho "Quadra" / "Lote".
export function extrairLinhas({ matriz, numericas }) {
  const cabIdx = matriz.findIndex((l) => l && l.some((v) => semAcento(v) === 'quadra'));
  if (cabIdx < 0) throw new Error('Cabeçalho não encontrado. O arquivo deve ter as colunas "Quadra" e "Lote".');
  const cab = matriz[cabIdx].map(semAcento);
  const iQ = cab.indexOf('quadra');
  const iL = cab.indexOf('lote');
  if (iL < 0) throw new Error('Coluna "Lote" não encontrada.');
  const colunasIgnoradas = matriz[cabIdx].filter((c, i) => i !== iQ && i !== iL && String(c ?? '').trim()).map((c) => String(c).trim());
  const linhas = [];
  for (let i = cabIdx + 1; i < matriz.length; i++) {
    const l = matriz[i];
    if (!l || l.every((v) => String(v ?? '').trim() === '')) continue;
    linhas.push({
      linha: i + 1,
      quadra: String(l[iQ] ?? '').replace(/\s+/g, ' ').trim(),
      lote: String(l[iL] ?? '').replace(/\s+/g, ' ').trim(),
      numerico_excel: numericas.has(i + 1),
    });
  }
  if (!linhas.length) throw new Error('O arquivo não possui registros abaixo do cabeçalho.');
  return { linhas, colunas_ignoradas: colunasIgnoradas };
}

export async function sha256Hex(bytes) {
  // crypto.subtle só existe em HTTPS/localhost; na rede local sem HTTPS usa a implementação abaixo.
  const h = globalThis.crypto && crypto.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)) : sha256Js(bytes);
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 (FIPS 180-4) em JavaScript puro.
function sha256Js(dados) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const u = new Uint8Array(dados);
  const tam = Math.ceil((u.length + 9) / 64) * 64;
  const m = new Uint8Array(tam);
  m.set(u);
  m[u.length] = 0x80;
  const bits = u.length * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(tam - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(tam - 4, bits >>> 0);
  const W = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < tam; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  H.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}
export const _sha256Js = sha256Js;
