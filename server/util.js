'use strict';

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (msg, extra) => new HttpError(400, msg, extra);
const forbidden = (msg = 'Você não tem permissão para esta operação.') => new HttpError(403, msg);
const notFound = (msg = 'Registro não encontrado.') => new HttpError(404, msg);
const conflict = (msg, extra) => new HttpError(409, msg, extra);

// Normaliza texto: remove espaços extras; retorna null se vazio.
function str(v, max = 500) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}
// Texto multilinha (observações)
function text(v, max = 4000) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  return s.slice(0, max);
}
function req(v, nomeCampo) {
  if (v === null || v === undefined || v === '') throw bad(`Informe ${nomeCampo}.`);
  return v;
}
function int(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function likeEscape(s) {
  return '%' + String(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

module.exports = { HttpError, bad, forbidden, notFound, conflict, str, text, req, int, likeEscape };
