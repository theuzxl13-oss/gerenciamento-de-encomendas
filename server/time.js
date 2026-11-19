'use strict';
// Utilitários de data/hora no fuso America/Sao_Paulo.
// Instantes são gravados em UTC (ISO-8601); datas locais (YYYY-MM-DD) são calculadas aqui.

const TZ = 'America/Sao_Paulo';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

function localParts(date = new Date()) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    seconds: p.second,
  };
}

// Diferença (em minutos) entre o horário local de São Paulo e UTC no instante informado.
function offsetMinutes(date) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function isTime(s) { return typeof s === 'string' && TIME_RE.test(s); }

// Converte data/hora local de São Paulo para instante UTC (Date).
function localToUtc(dateStr, timeStr = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = offsetMinutes(new Date(guess));
  let utc = guess - off * 60000;
  const off2 = offsetMinutes(new Date(utc));
  if (off2 !== off) utc = guess - off2 * 60000;
  return new Date(utc);
}

function todayLocal() { return localParts().date; }

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(fromDate, toDate) {
  const a = Date.UTC(...fromDate.split('-').map((v, i) => (i === 1 ? +v - 1 : +v)));
  const b = Date.UTC(...toDate.split('-').map((v, i) => (i === 1 ? +v - 1 : +v)));
  return Math.round((b - a) / 86400000);
}

function nowIso() { return new Date().toISOString(); }

// Formatação para exibição (relatórios do servidor)
function fmtDateTime(iso) {
  if (!iso) return '';
  const p = localParts(new Date(iso));
  const [y, m, d] = p.date.split('-');
  return `${d}/${m}/${y} ${p.time}`;
}
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

module.exports = {
  TZ, localParts, localToUtc, todayLocal, addDays, daysBetween, nowIso,
  isDate, isTime, fmtDateTime, fmtDate, offsetMinutes,
};
