// Estado compartilhado da sessão e cache de cadastros auxiliares (sempre lidos do servidor).
import { api } from './api.js';
import { natural } from './ui.js';

export const estado = {
  usuario: null,
  config: { plantoes: [], dias_alerta: 7, dias_critico: 15, minutos_tolerancia_horario: 15 },
  transportadoras: [],
  usuarios: [],
  quadras: [],
  lotes: [],
};

export const ehAdmin = () => estado.usuario && estado.usuario.perfil === 'ADMIN';

export async function carregarConfig() { estado.config = await api.get('/configuracoes'); }
export async function carregarTransportadoras() { estado.transportadoras = await api.get('/transportadoras'); }
export async function carregarUsuarios() { estado.usuarios = await api.get('/usuarios/lista?todos=1'); }
export async function carregarQuadrasLotes() {
  const [q, l] = await Promise.all([api.get('/quadras'), api.get('/lotes')]);
  estado.quadras = q;
  estado.lotes = l;
}
export async function carregarTudo() {
  await Promise.all([carregarConfig(), carregarTransportadoras(), carregarUsuarios(), carregarQuadrasLotes()]);
}

export const quadrasAtivas = () => estado.quadras.filter((q) => q.ativo);
export const lotesDaQuadra = (qid, soAtivos = true) => estado.lotes
  .filter((l) => String(l.quadra_id) === String(qid) && (!soAtivos || l.ativo))
  .sort((a, b) => natural(a.codigo, b.codigo));
export const usuariosAtivos = () => estado.usuarios.filter((u) => u.ativo);
