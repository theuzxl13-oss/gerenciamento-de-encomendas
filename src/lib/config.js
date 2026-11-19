export const CONFIG_PADRAO = {
  plantoes: [], // definidos pelo administrador em Configurações
  dias_alerta: 7,
  dias_critico: 15,
  backup_retencao_dias: 30,
  backup_automatico: true,
  minutos_tolerancia_horario: 15,
};

export async function getConfig(db) {
  const cfg = { ...CONFIG_PADRAO };
  const { results } = await db.prepare('SELECT chave, valor FROM configuracoes').all();
  for (const r of results) {
    try { cfg[r.chave] = JSON.parse(r.valor); } catch { /* ignora valor inválido */ }
  }
  return cfg;
}

// Erros de restrição do SQLite/D1 (triggers e índices únicos) traduzidos.
export function erroRestricao(e, marcador) {
  const msg = String((e && e.message) || '');
  return msg.includes(marcador);
}
