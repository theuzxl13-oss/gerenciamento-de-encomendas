'use strict';
// Testes de integração da API: operações reais contra o servidor e o banco SQLite.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { iniciar, cliente } = require('./helpers');
const { todayLocal, addDays, localParts } = require('../server/time');

let srv;
let admin; let ctrl; let ctrl2;
const ids = {};
const SENHA = 'SenhaForte123';
const PNG = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8CFC0F01F0005000201E2A3D6A80000000049454E44AE426082', 'hex');

before(async () => { srv = await iniciar(); admin = cliente(srv.base); ctrl = cliente(srv.base); ctrl2 = cliente(srv.base); });
after(async () => { if (srv) await srv.parar(); });

test('primeiro acesso: configuração do administrador', async () => {
  let r = await admin.get('/api/setup');
  assert.equal(r.data.precisa_configurar, true);
  r = await admin.post('/api/auth/login', { login: 'admin', senha: SENHA });
  assert.equal(r.status, 401);
  r = await admin.post('/api/setup', { nome: 'Administrador Teste', login: 'admin', senha: 'curta' });
  assert.equal(r.status, 400, 'senha fraca deve ser recusada');
  r = await admin.post('/api/setup', { nome: 'Administrador Teste', login: 'admin', email: 'adm@exemplo.test', senha: SENHA });
  assert.equal(r.status, 201);
  r = await admin.get('/api/auth/me');
  assert.equal(r.data.perfil, 'ADMIN');
  const outro = cliente(srv.base);
  r = await outro.post('/api/setup', { nome: 'Invasor', login: 'x', senha: SENHA });
  assert.equal(r.status, 409, 'setup só pode ocorrer uma vez');
});

test('segurança: CSRF, sessão obrigatória e login por e-mail', async () => {
  let r = await fetch(srv.base + '/api/transportadoras', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: admin.cookie }, body: '{"nome":"X"}' });
  assert.equal(r.status, 403);
  const anon = cliente(srv.base);
  r = await anon.get('/api/encomendas');
  assert.equal(r.status, 401);
  r = await anon.post('/api/auth/login', { login: 'adm@exemplo.test', senha: SENHA });
  assert.equal(r.status, 200);
});

test('usuários e perfis', async () => {
  let r = await admin.post('/api/usuarios', { nome: 'Carlos Controlador', login: 'carlos', perfil: 'CONTROLADOR', senha: SENHA });
  assert.equal(r.status, 201); ids.carlos = r.data.id;
  r = await admin.post('/api/usuarios', { nome: 'Dora Controladora', login: 'dora', perfil: 'CONTROLADOR', senha: SENHA });
  assert.equal(r.status, 201); ids.dora = r.data.id;
  r = await admin.post('/api/usuarios', { nome: 'Dup', login: 'CARLOS', perfil: 'CONTROLADOR', senha: SENHA });
  assert.equal(r.status, 409, 'login duplicado');
  assert.equal((await ctrl.post('/api/auth/login', { login: 'carlos', senha: SENHA })).status, 200);
  assert.equal((await ctrl2.post('/api/auth/login', { login: 'dora', senha: SENHA })).status, 200);
  assert.equal((await ctrl.get('/api/usuarios')).status, 403);
  assert.equal((await ctrl.get('/api/auditoria')).status, 403);
  assert.equal((await ctrl.post('/api/usuarios', { nome: 'X', login: 'xx', perfil: 'ADMIN', senha: SENHA })).status, 403);
  r = await ctrl.get('/api/usuarios/lista');
  assert.ok(r.data.some((u) => u.nome === 'Dora Controladora'));
  r = await admin.put(`/api/usuarios/${(await admin.get('/api/auth/me')).data.id}`, { ativo: false });
  assert.equal(r.status, 400, 'admin não pode se desativar');
});

test('bloqueio após 5 tentativas de senha errada', async () => {
  const r0 = await admin.post('/api/usuarios', { nome: 'Eva', login: 'eva', perfil: 'CONTROLADOR', senha: SENHA });
  ids.eva = r0.data.id;
  const c = cliente(srv.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { login: 'eva', senha: 'errada000' })).status, 401);
  const r = await c.post('/api/auth/login', { login: 'eva', senha: SENHA });
  assert.equal(r.status, 423);
  await admin.post(`/api/usuarios/${ids.eva}/redefinir-senha`, { senha: 'OutraSenha456' });
  assert.equal((await c.post('/api/auth/login', { login: 'eva', senha: 'OutraSenha456' })).status, 200);
  assert.equal((await c.get('/api/auth/me')).data.trocar_senha, true);
  // usuário desativado não consegue entrar e perde a sessão
  await admin.put(`/api/usuarios/${ids.eva}`, { ativo: false });
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('quadras e lotes: cadastro manual e permissões', async () => {
  let r = await admin.post('/api/quadras', { codigo: 'A' });
  assert.equal(r.status, 201); ids.qA = r.data.id;
  r = await admin.post('/api/quadras', { codigo: 'a' });
  assert.equal(r.status, 409, 'quadra duplicada (sem diferenciar maiúsculas)');
  r = await admin.post('/api/lotes', { quadra_id: ids.qA, codigo: '1', endereco: 'Endereço de teste 1' });
  assert.equal(r.status, 201); ids.lA1 = r.data.id;
  r = await admin.post('/api/lotes', { quadra_id: ids.qA, codigo: '2' });
  ids.lA2 = r.data.id;
  r = await admin.post('/api/lotes', { quadra_id: ids.qA, codigo: '3' });
  ids.lA3 = r.data.id;
  await admin.put(`/api/lotes/${ids.lA3}`, { ativo: false });
  assert.equal((await ctrl.post('/api/quadras', { codigo: 'Z' })).status, 403);
  r = await ctrl.get(`/api/lotes?quadra_id=${ids.qA}&ativos=1`);
  assert.deepEqual(r.data.map((l) => l.codigo), ['1', '2']);
});

test('quadras e lotes: importação de planilha CSV e XLSX (simulação + gravação)', async () => {
  const csv = 'Quadra;Lote;Endereço;Observação\nB;1;;\nB;2;;\nB;10;;\nB;2;;\n;5;;\nA;1;Endereço atualizado;\n';
  let fd = new FormData();
  fd.append('arquivo', new Blob([csv], { type: 'text/csv' }), 'relacao.csv');
  let r = await admin.post('/api/quadras-lotes/importar?simular=1', fd);
  assert.equal(r.status, 200);
  assert.equal(r.data.simulacao, true);
  assert.equal(r.data.quadras_novas, 1);
  assert.equal(r.data.lotes_novos, 3);
  assert.equal(r.data.lotes_atualizados, 1);
  assert.equal(r.data.erros.length, 2);
  assert.equal((await admin.get('/api/quadras')).data.length, 1, 'simulação não grava');
  fd = new FormData();
  fd.append('arquivo', new Blob([csv], { type: 'text/csv' }), 'relacao.csv');
  r = await admin.post('/api/quadras-lotes/importar', fd);
  assert.equal(r.data.lotes_novos, 3);
  r = await admin.get('/api/lotes?q=');
  const b = r.data.filter((l) => l.quadra_codigo === 'B').map((l) => l.codigo);
  assert.deepEqual(b, ['1', '2', '10'], 'ordenação natural');
  assert.equal(r.data.find((l) => l.id === ids.lA1).endereco, 'Endereço atualizado');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('x');
  ws.addRow(['Quadra', 'Lote', 'Endereço']);
  ws.addRow(['C', 7, null]);
  ws.addRow(['C', 8, null]);
  const buf = await wb.xlsx.writeBuffer();
  fd = new FormData();
  fd.append('arquivo', new Blob([buf]), 'relacao.xlsx');
  r = await admin.post('/api/quadras-lotes/importar', fd);
  assert.equal(r.data.lotes_novos, 2);
  r = await admin.get('/api/lotes');
  ids.lB1 = r.data.find((l) => l.quadra_codigo === 'B' && l.codigo === '1').id;
  ids.lC7 = r.data.find((l) => l.quadra_codigo === 'C' && l.codigo === '7').id;
  ids.qB = r.data.find((l) => l.quadra_codigo === 'B').quadra_id;
  r = await admin.get('/api/quadras-lotes/modelo.xlsx', { raw: true });
  assert.equal(r.status, 200);
});

test('transportadoras: iniciais e inclusão por controlador', async () => {
  let r = await ctrl.get('/api/transportadoras');
  const nomes = r.data.map((t) => t.nome);
  for (const n of ['Correios', 'Mercado Livre', 'Shopee', 'Amazon', 'Magazine Luiza', 'Transportadora', 'Entrega particular', 'Outros']) assert.ok(nomes.includes(n), n);
  ids.correios = r.data.find((t) => t.nome === 'Correios').id;
  ids.shopee = r.data.find((t) => t.nome === 'Shopee').id;
  r = await ctrl.post('/api/transportadoras', { nome: 'Jadlog' });
  assert.equal(r.status, 201); ids.jadlog = r.data.id;
  assert.equal((await ctrl.post('/api/transportadoras', { nome: 'jadlog' })).status, 409);
});

test('cadastro de encomendas: validações, identificador único e status inicial', async () => {
  let r = await ctrl.post('/api/encomendas', { descricao: 'Caixa', transportadora_id: ids.correios });
  assert.equal(r.status, 400, 'sem lote');
  r = await ctrl.post('/api/encomendas', { lote_id: ids.lA3, descricao: 'Caixa', transportadora_id: ids.correios });
  assert.equal(r.status, 400, 'lote inativo');
  r = await ctrl.post('/api/encomendas', { lote_id: ids.lA1, descricao: '', transportadora_id: ids.correios });
  assert.equal(r.status, 400, 'sem descrição');
  const amanha = addDays(todayLocal(), 1);
  r = await ctrl.post('/api/encomendas', { lote_id: ids.lA1, descricao: 'Caixa', transportadora_id: ids.correios, data: amanha, hora: '10:00' });
  assert.equal(r.status, 400, 'data futura');

  r = await ctrl.post('/api/encomendas', { lote_id: ids.lA1, descricao: 'Caixa média parda', transportadora_id: ids.correios, endereco_complementar: 'Casa dos fundos', observacoes: 'Frágil' });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'PENDENTE');
  assert.match(r.data.codigo, new RegExp(`^FI-${todayLocal().slice(0, 4)}-00001$`));
  assert.equal(r.data.recebido_por, 'Carlos Controlador', 'recebedor padrão = usuário logado');
  assert.equal(r.data.cadastrado_por, 'Carlos Controlador');
  assert.equal(r.data.recebido_data, todayLocal());
  ids.e1 = r.data.id;

  r = await ctrl.post('/api/encomendas', { lote_id: ids.lA2, descricao: 'Envelope', transportadora_id: ids.shopee, recebido_por_id: ids.dora });
  assert.equal(r.data.codigo.endsWith('00002'), true);
  assert.equal(r.data.recebido_por, 'Dora Controladora');
  assert.equal(r.data.cadastrado_por, 'Carlos Controlador');
  ids.e2 = r.data.id;

  // data retroativa (editável) – fuso America/Sao_Paulo
  const d10 = addDays(todayLocal(), -10);
  r = await ctrl.post('/api/encomendas', { lote_id: ids.lB1, descricao: 'Pacote antigo', transportadora_id: ids.jadlog, data: d10, hora: '23:30' });
  assert.equal(r.status, 201);
  assert.equal(r.data.recebido_data, d10);
  const utc = new Date(r.data.recebido_em);
  assert.equal(utc.toISOString().slice(11, 16), '02:30', '23:30 em São Paulo = 02:30 UTC');
  assert.equal(r.data.dias_espera, 10);
  ids.e3 = r.data.id;

  for (let i = 0; i < 4; i++) {
    r = await ctrl2.post('/api/encomendas', { lote_id: ids.lC7, descricao: `Volume ${i + 1}`, transportadora_id: ids.correios });
    ids[`c${i}`] = r.data.id;
  }
});

test('pesquisa por todos os filtros', async () => {
  const q = async (qs) => (await ctrl.get('/api/encomendas?' + qs)).data;
  assert.equal((await q(`quadra_id=${ids.qA}`)).total, 2);
  assert.equal((await q(`lote_id=${ids.lA2}`)).total, 1);
  assert.equal((await q('descricao=parda')).total, 1);
  assert.equal((await q(`transportadora_id=${ids.jadlog}`)).total, 1);
  assert.equal((await q(`recebido_por_id=${ids.dora}`)).total, 5);
  assert.equal((await q('status=PENDENTE')).total, 7);
  assert.equal((await q('q=Envelope')).total, 1);
  assert.equal((await q('quadra=B&lote=1')).total, 1);
  const d = addDays(todayLocal(), -10);
  assert.equal((await q(`data_ini=${d}&data_fim=${d}`)).total, 1);
  assert.equal((await q(`data_ini=${todayLocal()}`)).total, 6);
  assert.equal((await q('dias_min=7')).total, 1, 'tempo de espera ≥ 7 dias');
  assert.equal((await q('dias_max=0')).total, 6);
  const pag = await q('por_pagina=2&pagina=2');
  assert.equal(pag.itens.length, 2); assert.equal(pag.total, 7);
  assert.equal((await q('descricao=%25')).total, 0, 'curingas são escapados');
});

test('baixa (retirada própria) e bloqueio de baixa duplicada', async () => {
  let r = await ctrl.post('/api/retiradas', { encomenda_ids: [ids.e1], tipo: 'PROPRIA' });
  assert.equal(r.status, 400, 'nome de quem retirou é obrigatório');
  r = await ctrl.post('/api/retiradas', { encomenda_ids: [ids.e1], tipo: 'PROPRIA', retirado_por_nome: 'Morador Um', documento_retirante: '123' });
  assert.equal(r.status, 201);
  let e = (await ctrl.get(`/api/encomendas/${ids.e1}`)).data;
  assert.equal(e.status, 'RETIRADA');
  assert.equal(e.entregue_por, 'Carlos Controlador');
  assert.equal(e.lancado_por, 'Carlos Controlador');
  assert.equal(e.retirada_data, todayLocal());
  r = await ctrl2.post('/api/retiradas', { encomenda_ids: [ids.e1], tipo: 'PROPRIA', retirado_por_nome: 'Outra pessoa' });
  assert.equal(r.status, 409);
  assert.match(r.data.erro, /já foi retirada/);
  r = await ctrl2.post('/api/retiradas', { encomenda_ids: [ids.e1], tipo: 'OUTRO_PLANTAO', data: todayLocal(), retirado_por_nome: 'X', entregador_desconhecido: true, plantao: 'Noturno', observacoes: 'x' });
  assert.equal(r.status, 409, 'nem por outro plantão');
  // concorrência: dois computadores dando baixa ao mesmo tempo
  const [a, b] = await Promise.all([
    ctrl.post('/api/retiradas', { encomenda_ids: [ids.c0], tipo: 'PROPRIA', retirado_por_nome: 'Pessoa A' }),
    ctrl2.post('/api/retiradas', { encomenda_ids: [ids.c0], tipo: 'PROPRIA', retirado_por_nome: 'Pessoa B' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const cnt = srv.db.prepare('SELECT COUNT(*) n FROM retiradas WHERE encomenda_id = ?').get(ids.c0).n;
  assert.equal(cnt, 1);
  e = (await ctrl.get('/api/encomendas?status=PENDENTE')).data;
  assert.ok(!e.itens.some((x) => x.id === ids.e1 || x.id === ids.c0), 'retirada não permanece pendente');
});

test('retirada própria com horário corrigido exige justificativa', async () => {
  const hoje = todayLocal();
  const h = localParts().time;
  const horaAntiga = h > '01:00' ? '00:30' : null;
  const data = horaAntiga ? hoje : addDays(hoje, -1);
  const hora = horaAntiga || '23:00';
  let r = await ctrl.post('/api/retiradas', { encomenda_ids: [ids.c1], tipo: 'PROPRIA', retirado_por_nome: 'Morador', data, hora });
  assert.equal(r.status, 400);
  assert.equal(r.data.campo, 'justificativa_horario');
  r = await ctrl.post('/api/retiradas', { encomenda_ids: [ids.c1], tipo: 'PROPRIA', retirado_por_nome: 'Morador', data, hora, justificativa_horario: 'Sistema estava fora do ar no momento' });
  assert.equal(r.status, 201);
  const e = (await ctrl.get(`/api/encomendas/${ids.c1}`)).data;
  assert.equal(e.retirada_hora, hora);
  assert.equal(e.retiradas[0].justificativa_horario, 'Sistema estava fora do ar no momento');
});

test('retirada por outro plantão: validações e distinção lançador × entregador', async () => {
  const base = { encomenda_ids: [ids.e2], tipo: 'OUTRO_PLANTAO', data: todayLocal(), retirado_por_nome: 'Vizinho autorizado' };
  let r = await ctrl.post('/api/retiradas', { ...base, plantao: 'Noturno', entregador_desconhecido: true });
  assert.equal(r.status, 400, 'observação obrigatória');
  r = await ctrl.post('/api/retiradas', { ...base, observacoes: 'Informado pelo morador', entregador_desconhecido: true });
  assert.equal(r.status, 400, 'plantão obrigatório');
  r = await ctrl.post('/api/retiradas', { ...base, observacoes: 'x', plantao: 'Noturno' });
  assert.equal(r.status, 400, 'precisa informar entregador ou "não sei"');
  r = await ctrl.post('/api/retiradas', { ...base, observacoes: 'x', plantao: 'Noturno', entregue_por_id: ids.carlos });
  assert.equal(r.status, 400, 'não pode atribuir a entrega ao próprio usuário logado');
  r = await ctrl.post('/api/retiradas', { ...base, observacoes: 'Encomenda não estava na prateleira; livro do plantão anterior indica retirada', plantao: 'Noturno', entregador_desconhecido: true });
  assert.equal(r.status, 201);
  let e = (await ctrl.get(`/api/encomendas/${ids.e2}`)).data;
  assert.equal(e.status, 'RETIRADA_OUTRO_PLANTAO');
  assert.equal(e.entregue_por, null, 'entregador desconhecido não é atribuído a ninguém');
  assert.equal(e.entregador_desconhecido, 1);
  assert.equal(e.lancado_por, 'Carlos Controlador');
  assert.equal(e.retirada_hora, null, 'horário desconhecido fica em branco');
  // com entregador conhecido (outro controlador)
  r = await ctrl.post('/api/retiradas', { encomenda_ids: [ids.c2], tipo: 'OUTRO_PLANTAO', data: todayLocal(), hora: '00:05', retirado_por_nome: 'Moradora', entregue_por_id: ids.dora, plantao: 'Noturno', observacoes: 'Confirmado com a Dora' });
  assert.equal(r.status, 201);
  e = (await ctrl.get(`/api/encomendas/${ids.c2}`)).data;
  assert.equal(e.entregue_por, 'Dora Controladora');
  assert.equal(e.lancado_por, 'Carlos Controlador');
  const aud = e.alteracoes.find((a) => a.acao === 'RETIRADA_OUTRO_PLANTAO_REGISTRADA');
  assert.equal(aud.usuario_nome, 'Carlos Controlador');
  // entregador conhecido sem conta no sistema
  r = await ctrl.post('/api/retiradas', { encomenda_ids: [ids.c3], tipo: 'OUTRO_PLANTAO', data: todayLocal(), retirado_por_nome: 'Moradora', entregue_por_nome: 'Folguista João', plantao: 'Diurno', observacoes: 'Anotado no caderno' });
  assert.equal(r.status, 201);
  e = (await ctrl.get(`/api/encomendas/${ids.c3}`)).data;
  assert.equal(e.entregue_por, 'Folguista João');
});

test('baixa de várias encomendas de uma vez (mesmo morador)', async () => {
  const r1 = await ctrl.post('/api/encomendas', { lote_id: ids.lA2, descricao: 'Caixa 1', transportadora_id: ids.correios });
  const r2 = await ctrl.post('/api/encomendas', { lote_id: ids.lA2, descricao: 'Caixa 2', transportadora_id: ids.correios });
  let r = await ctrl.post('/api/retiradas', { encomenda_ids: [r1.data.id, r2.data.id, ids.e1], tipo: 'PROPRIA', retirado_por_nome: 'Morador' });
  assert.equal(r.status, 409, 'uma já retirada aborta tudo (transação)');
  assert.equal((await ctrl.get(`/api/encomendas/${r1.data.id}`)).data.status, 'PENDENTE');
  r = await ctrl.post('/api/retiradas', { encomenda_ids: [r1.data.id, r2.data.id], tipo: 'PROPRIA', retirado_por_nome: 'Morador' });
  assert.equal(r.status, 201);
  assert.equal(r.data.retiradas.length, 2);
  ids.lote2a = r1.data.id;
});

test('edição justificada com auditoria e restrições do controlador', async () => {
  let r = await ctrl.put(`/api/encomendas/${ids.e3}`, { descricao: 'Pacote antigo (caixa azul)' });
  assert.equal(r.status, 400, 'justificativa obrigatória');
  r = await ctrl.put(`/api/encomendas/${ids.e3}`, { descricao: 'Pacote antigo (caixa azul)', justificativa: 'Descrição incompleta' });
  assert.equal(r.status, 200);
  assert.equal(r.data.descricao, 'Pacote antigo (caixa azul)');
  r = await ctrl2.put(`/api/encomendas/${ids.e3}`, { descricao: 'x', justificativa: 'y' });
  assert.equal(r.status, 403, 'controlador não edita encomenda cadastrada por outro');
  r = await ctrl.put(`/api/encomendas/${ids.e1}`, { descricao: 'x', justificativa: 'y' });
  assert.equal(r.status, 403, 'controlador não edita encomenda já retirada');
  r = await admin.put(`/api/encomendas/${ids.e1}`, { lote_id: ids.lA2, justificativa: 'Lote informado errado' });
  assert.equal(r.status, 200);
  const e = (await admin.get(`/api/encomendas/${ids.e3}`)).data;
  const ed = e.alteracoes.find((a) => a.acao === 'ENCOMENDA_EDITADA');
  assert.deepEqual(ed.detalhes.descricao, { antes: 'Pacote antigo', depois: 'Pacote antigo (caixa azul)' });
  assert.equal(ed.justificativa, 'Descrição incompleta');
  assert.equal(ed.usuario_nome, 'Carlos Controlador');
});

test('correção de retirada e estorno (somente administrador, justificados)', async () => {
  const enc = (await admin.get(`/api/encomendas/${ids.e1}`)).data;
  let r = await ctrl.put(`/api/retiradas/${enc.retirada_id}`, { retirado_por_nome: 'X', justificativa: 'y' });
  assert.equal(r.status, 403);
  r = await admin.put(`/api/retiradas/${enc.retirada_id}`, { retirado_por_nome: 'Morador Um da Silva' });
  assert.equal(r.status, 400);
  r = await admin.put(`/api/retiradas/${enc.retirada_id}`, { retirado_por_nome: 'Morador Um da Silva', justificativa: 'Nome completo' });
  assert.equal(r.status, 200);
  assert.equal(r.data.retirado_por_nome, 'Morador Um da Silva');
  assert.equal(r.data.entregue_por, 'Carlos Controlador', 'entregador preservado');

  assert.equal((await ctrl.post(`/api/retiradas/${enc.retirada_id}/estornar`, { motivo: 'x' })).status, 403);
  r = await admin.post(`/api/retiradas/${enc.retirada_id}/estornar`, { motivo: 'Baixa feita na encomenda errada' });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'PENDENTE');
  const ficha = (await admin.get(`/api/encomendas/${ids.e1}`)).data;
  assert.equal(ficha.retiradas.length, 1, 'retirada estornada continua no histórico');
  assert.ok(ficha.retiradas[0].estornada_em);
  r = await ctrl.post('/api/retiradas', { encomenda_ids: [ids.e1], tipo: 'PROPRIA', retirado_por_nome: 'Morador Um' });
  assert.equal(r.status, 201, 'após estorno pode ser baixada novamente');
  assert.equal((await admin.get(`/api/encomendas/${ids.e1}`)).data.retiradas.length, 2);
});

test('cancelamento lógico: registro nunca desaparece', async () => {
  const r0 = await ctrl.post('/api/encomendas', { lote_id: ids.lA1, descricao: 'Lançada por engano', transportadora_id: ids.correios });
  const id = r0.data.id;
  assert.equal((await ctrl.post(`/api/encomendas/${id}/cancelar`, { motivo: 'x' })).status, 403);
  assert.equal((await admin.post(`/api/encomendas/${id}/cancelar`, {})).status, 400);
  let r = await admin.post(`/api/encomendas/${id}/cancelar`, { motivo: 'Cadastro duplicado' });
  assert.equal(r.data.status, 'CANCELADA');
  r = await ctrl.get('/api/encomendas?descricao=engano');
  assert.equal(r.data.total, 0, 'canceladas fora da pesquisa padrão');
  r = await ctrl.get('/api/encomendas?descricao=engano&status=CANCELADA');
  assert.equal(r.data.total, 1, 'mas continuam consultáveis');
  r = await ctrl.post('/api/retiradas', { encomenda_ids: [id], tipo: 'PROPRIA', retirado_por_nome: 'x' });
  assert.equal(r.status, 409);
});

test('banco de dados impede exclusões e alteração da auditoria', () => {
  assert.throws(() => srv.db.prepare('DELETE FROM encomendas WHERE id = ?').run(ids.e1), /não podem ser apagadas/);
  assert.throws(() => srv.db.prepare('DELETE FROM retiradas').run(), /não podem ser apagadas/);
  assert.throws(() => srv.db.prepare('DELETE FROM auditoria').run(), /permanente/);
  assert.throws(() => srv.db.prepare("UPDATE auditoria SET acao = 'X'").run(), /permanente/);
  assert.throws(() => srv.db.prepare('DELETE FROM usuarios').run(), /desative/);
  assert.throws(() => srv.db.prepare('DELETE FROM lotes WHERE id = ?').run(ids.lA1), /desative/);
});

test('comprovantes: upload, acesso restrito e remoção lógica', async () => {
  let fd = new FormData();
  fd.append('tipo', 'ASSINATURA');
  fd.append('arquivo', new Blob([PNG], { type: 'image/png' }), 'assinatura.png');
  let r = await ctrl.post(`/api/encomendas/${ids.e2}/anexos`, fd);
  assert.equal(r.status, 201);
  const aid = r.data.id;
  fd = new FormData();
  fd.append('tipo', 'DOCUMENTO');
  fd.append('arquivo', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'falso.png');
  r = await ctrl.post(`/api/encomendas/${ids.e2}/anexos`, fd);
  assert.equal(r.status, 400, 'conteúdo inválido recusado mesmo com mime falso');
  const res = await ctrl.get(`/api/anexos/${aid}/arquivo`, { raw: true });
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  const anon = await fetch(`${srv.base}/api/anexos/${aid}/arquivo`);
  assert.equal(anon.status, 401, 'sem login não acessa comprovante');
  assert.equal((await ctrl.post(`/api/anexos/${aid}/remover`, { motivo: 'x' })).status, 403);
  assert.equal((await admin.post(`/api/anexos/${aid}/remover`, { motivo: 'Imagem errada' })).status, 200);
  assert.equal((await ctrl.get(`/api/anexos/${aid}/arquivo`, { raw: true })).status, 404);
  assert.equal((await admin.get(`/api/anexos/${aid}/arquivo`, { raw: true })).status, 200, 'admin ainda acessa para auditoria');
  const ficha = (await ctrl.get(`/api/encomendas/${ids.e2}`)).data;
  assert.equal(ficha.anexos.length, 1);
  assert.ok(ficha.anexos[0].removido_em);
});

test('dashboard: indicadores consistentes', async () => {
  const d = (await ctrl.get('/api/dashboard')).data;
  const pend = (await ctrl.get('/api/encomendas?status=PENDENTE')).data.total;
  assert.equal(d.indicadores.pendentes, pend);
  assert.equal(d.indicadores.outro_plantao_hoje, 3);
  assert.equal(d.indicadores.total_recebido, srv.db.prepare("SELECT COUNT(*) n FROM encomendas WHERE status <> 'CANCELADA'").get().n);
  assert.equal(d.indicadores.recebidas_hoje, d.indicadores.total_recebido - 1);
  assert.equal(d.indicadores.pendentes_alerta, 1);
  assert.ok(d.recentes.length > 0);
  assert.equal(d.antigas[0].id, ids.e3, 'mais antiga primeiro');
});

test('relatórios: JSON, PDF, Excel e por funcionário', async () => {
  let r = await ctrl.get('/api/relatorios?tipo_retirada=OUTRO_PLANTAO');
  assert.equal(r.data.total, 3);
  assert.ok(r.data.itens.every((i) => i.status === 'RETIRADA_OUTRO_PLANTAO'));
  r = await ctrl.get(`/api/relatorios?controlador_id=${ids.dora}`);
  assert.ok(r.data.total >= 4);
  r = await ctrl.get(`/api/relatorios?quadra_id=${ids.qA}&status=PENDENTE`);
  assert.ok(r.data.itens.every((i) => i.quadra === 'A' && i.status === 'PENDENTE'));
  const pdf = await ctrl.get(`/api/relatorios?formato=pdf&data_ini=${addDays(todayLocal(), -30)}`, { raw: true });
  assert.equal(pdf.status, 200);
  const pbuf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pbuf.subarray(0, 5).toString(), '%PDF-');
  const xls = await ctrl.get('/api/relatorios?formato=xlsx', { raw: true });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xls.arrayBuffer()));
  const ws = wb.getWorksheet('Encomendas');
  const total = (await ctrl.get('/api/relatorios')).data.total;
  assert.equal(ws.rowCount - 4, total, 'todas as linhas exportadas');
  assert.equal(ws.getRow(4).getCell(1).value, 'Identificador');
  r = await ctrl.get('/api/relatorios/funcionarios');
  const carlos = r.data.linhas.find((l) => l.nome === 'Carlos Controlador');
  const dora = r.data.linhas.find((l) => l.nome === 'Dora Controladora');
  assert.equal(carlos.lancamentos_outro_plantao, 3);
  assert.equal(dora.entregas_informadas_outro_plantao, 1);
  assert.equal(dora.lancamentos_outro_plantao, 0);
  const fpdf = await ctrl.get('/api/relatorios/funcionarios?formato=pdf', { raw: true });
  assert.equal(Buffer.from(await fpdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('auditoria: registra todas as operações com usuário e horário', async () => {
  const r = await admin.get('/api/auditoria?por_pagina=200');
  const acoes = new Set(r.data.itens.map((a) => a.acao));
  for (const a of ['CONFIGURACAO_INICIAL', 'LOGIN', 'USUARIO_CRIADO', 'ENCOMENDA_CADASTRADA', 'ENCOMENDA_EDITADA', 'RETIRADA_REGISTRADA',
    'RETIRADA_OUTRO_PLANTAO_REGISTRADA', 'RETIRADA_CORRIGIDA', 'RETIRADA_ESTORNADA', 'ENCOMENDA_CANCELADA', 'ANEXO_ADICIONADO',
    'ANEXO_REMOVIDO', 'QUADRAS_LOTES_IMPORTADOS', 'LOGIN_BLOQUEADO', 'RELATORIO_EXPORTADO']) assert.ok(acoes.has(a), a);
  assert.ok(r.data.itens.every((a) => a.ocorrido_em && a.acao));
  const f = await admin.get(`/api/auditoria?encomenda_id=${ids.e1}`);
  assert.ok(f.data.itens.every((a) => a.encomenda_id === ids.e1));
});

test('configurações e troca de senha', async () => {
  let r = await admin.put('/api/configuracoes', { plantoes: ['Turno A', 'Turno B', 'Turno A'], dias_alerta: 5, dias_critico: 10 });
  assert.deepEqual(r.data.plantoes, ['Turno A', 'Turno B']);
  assert.equal((await ctrl.put('/api/configuracoes', { dias_alerta: 1 })).status, 403);
  assert.equal((await admin.put('/api/configuracoes', { dias_alerta: 20, dias_critico: 10 })).status, 400);
  r = await ctrl.post('/api/auth/senha', { senha_atual: 'errada', nova_senha: 'NovaSenha789' });
  assert.equal(r.status, 400);
  r = await ctrl.post('/api/auth/senha', { senha_atual: SENHA, nova_senha: 'NovaSenha789' });
  assert.equal(r.status, 200);
  assert.equal((await cliente(srv.base).post('/api/auth/login', { login: 'carlos', senha: 'NovaSenha789' })).status, 200);
});

test('backup: criação e download de cópia íntegra do banco', async () => {
  let r = await admin.post('/api/backups');
  assert.equal(r.status, 201);
  assert.equal((await ctrl.get('/api/backups')).status, 403);
  r = await admin.get('/api/backups');
  assert.ok(r.data.length >= 1);
  const dl = await admin.get(`/api/backups/${encodeURIComponent(r.data[0].nome)}`, { raw: true });
  const buf = Buffer.from(await dl.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await admin.get('/api/backups/..%2F..%2Fencomendas.db')).status, 404);
});

test('persistência: dados permanecem após reiniciar o servidor', async () => {
  const total = (await admin.get('/api/encomendas?incluir_canceladas=1')).data.total;
  const dataDir = srv.dataDir;
  await srv.parar();
  srv = await iniciar(dataDir);
  const c = cliente(srv.base);
  assert.equal((await c.get('/api/setup')).data.precisa_configurar, false);
  assert.equal((await c.post('/api/auth/login', { login: 'admin', senha: SENHA })).status, 200);
  assert.equal((await c.get('/api/encomendas?incluir_canceladas=1')).data.total, total);
  const e = (await c.get(`/api/encomendas/${ids.e2}`)).data;
  assert.equal(e.status, 'RETIRADA_OUTRO_PLANTAO');
  // sequência do identificador continua após reinício
  const lote = (await c.get('/api/lotes?ativos=1')).data[0];
  const n = await c.post('/api/encomendas', { lote_id: lote.id, descricao: 'Após reinício', transportadora_id: ids.correios });
  assert.equal(n.status, 201);
  assert.ok(Number(n.data.codigo.slice(-5)) > total);
});
