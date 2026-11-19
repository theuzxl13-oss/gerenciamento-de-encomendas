// Senhas, tokens e hashes com Web Crypto (mesmo código no Cloudflare Workers e no Node.js).
import { HttpError } from './util.js';

// 100.000 iterações é o máximo aceito pelo PBKDF2 do Cloudflare Workers.
export let PBKDF2_ITERACOES = 100000;
// Ajustável por variável de ambiente (wrangler.toml [vars]); hashes antigos continuam válidos, pois guardam as próprias iterações.
export function definirIteracoes(n) {
  const v = Number(n);
  if (Number.isInteger(v) && v >= 10000 && v <= 100000) PBKDF2_ITERACOES = v;
}
const enc = new TextEncoder();

export function b64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
export function deB64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
export const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(dados) {
  const bytes = typeof dados === 'string' ? enc.encode(dados) : dados;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

export function tokenAleatorio(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function derivar(senha, salt, iteracoes) {
  const key = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteracoes }, key, 256));
}

export async function hashSenha(senha, iteracoes = PBKDF2_ITERACOES) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await derivar(senha, salt, iteracoes);
  return `pbkdf2$sha256$${iteracoes}$${b64(salt)}$${b64(h)}`;
}

export async function verificarSenha(senha, armazenado) {
  try {
    const [alg, dig, it, saltB64, hashB64] = String(armazenado).split('$');
    if (alg !== 'pbkdf2' || dig !== 'sha256') return false;
    const esperado = deB64(hashB64);
    const calc = await derivar(senha, deB64(saltB64), Number(it));
    if (calc.length !== esperado.length) return false;
    let dif = 0;
    for (let i = 0; i < calc.length; i++) dif |= calc[i] ^ esperado[i];
    return dif === 0;
  } catch {
    return false;
  }
}

export function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) throw new HttpError(400, 'A senha deve conter letras e números.');
}
