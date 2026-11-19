// Cliente da API: todas as operações são persistidas no servidor (nada fica só no navegador).
export class ApiErro extends Error {
  constructor(status, msg, dados) { super(msg); this.status = status; this.dados = dados || {}; }
}

let aoExpirar = () => {};
export function definirAoExpirar(fn) { aoExpirar = fn; }

async function chamar(method, url, body) {
  const headers = { 'X-Requested-With': 'FazendaDaIlha' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch('/api' + url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiErro(0, 'Sem conexão com o servidor. Verifique a rede e tente novamente. Nada foi gravado.');
  }
  const ct = res.headers.get('content-type') || '';
  const dados = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/setup')) aoExpirar();
    throw new ApiErro(res.status, (dados && dados.erro) || `Erro ${res.status}`, dados);
  }
  return dados;
}

export const api = {
  get: (u) => chamar('GET', u),
  post: (u, b = {}) => chamar('POST', u, b),
  put: (u, b = {}) => chamar('PUT', u, b),
  del: (u, b = {}) => chamar('DELETE', u, b),
};

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}

// Download de arquivo gerado pelo servidor (PDF/Excel/backup)
export async function baixar(url, nomePadrao = 'arquivo') {
  const res = await fetch('/api' + url, { credentials: 'same-origin' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ApiErro(res.status, d.erro || 'Falha ao gerar o arquivo.');
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? m[1] : nomePadrao;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
