'use strict';
// Teste ponta a ponta no navegador (Playwright/Chromium): fluxo completo da portaria pela interface.
// Defina SCREENSHOTS=<pasta> para salvar capturas de tela.
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { iniciar } = require('./helpers');
const { todayLocal } = require('../server/time');

let srv; let browser; let page;
const erros = [];
const SHOTS = process.env.SCREENSHOTS;
const shot = async (nome, p = page) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${nome}.png`), fullPage: true }); };

before(async () => {
  srv = await iniciar();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|409|Unauthorized|Conflict/.test(m.text())) erros.push(`console: ${m.text()}`); });
});
afterEach(async (t) => { if (process.env.DEBUG_SHOTS && page) await page.screenshot({ path: path.join(process.env.DEBUG_SHOTS, `${t.name.slice(0, 30)}.png`) }).catch(() => {}); });
after(async () => { if (browser) await browser.close(); if (srv) await srv.parar(); });

const toast = (txt) => page.locator('.toast', { hasText: txt }).first().waitFor();

test('primeiro acesso cria o administrador pela interface', async () => {
  await page.goto(srv.base);
  await page.getByRole('heading', { name: 'Configuração inicial' }).waitFor();
  await shot('01-configuracao-inicial');
  await page.fill('input[name=nome]', 'Administrador da Portaria');
  await page.fill('input[name=login]', 'admin');
  await page.fill('input[name=senha]', 'SenhaForte123');
  await page.fill('input[name=senha2]', 'SenhaForte123');
  await page.click('button[type=submit]');
  await page.getByRole('heading', { name: 'Quadras e lotes' }).waitFor();
});

test('importa a relação de quadras e lotes por planilha (prévia + confirmação)', async () => {
  const csv = process.env.OFFICIAL_CSV || path.join(srv.dataDir, 'relacao.csv');
  if (!process.env.OFFICIAL_CSV) fs.writeFileSync(csv, '﻿Quadra,Lote\n01,01\n01,02\n01,03\n02,01\n02,02\n02,2\n');
  await page.click('#importar');
  await page.setInputFiles('#imp-arq', csv);
  await page.click('#imp-previa');
  await page.getByText('Prévia — nada foi gravado ainda.').waitFor();
  await page.locator('#imp-lista tbody tr').first().waitFor();
  await shot('02-importacao-previa');
  assert.equal(await page.locator('#lista-quadras [data-q]').count(), 0, 'nada gravado na prévia');
  if (!process.env.OFFICIAL_CSV) {
    await page.locator('[data-filtro=DUPLICADO]').click();
    assert.equal(await page.locator('#imp-lista tbody tr').count(), 1, 'duplicado 02/2 ≡ 02/02');
  }
  await page.click('#imp-confirmar');
  await page.getByText('Importação concluída e gravada no banco de dados.').waitFor();
  await shot('02b-importacao-resultado');
  await page.click('.modal [data-fechar]');
  await page.locator('#lista-quadras', { hasText: 'Quadra 02' }).waitFor();
  await page.locator('#lotes tbody tr').first().waitFor();
  assert.equal(await page.locator('#lotes tbody tr').first().locator('td').nth(1).textContent(), '01', 'zero à esquerda preservado');
  await page.locator('#hist-imp td', { hasText: 'Administrador da Portaria' }).waitFor();
  await shot('03-quadras-lotes');
});

test('cria usuário controlador', async () => {
  await page.click('a[data-rota=usuarios]');
  await page.click('#novo');
  await page.fill('#f-u input[name=nome]', 'Bruno Controlador');
  await page.fill('#f-u input[name=login]', 'bruno');
  await page.fill('#f-u input[name=senha]', 'Inicial12345');
  await page.click('#u-ok');
  await page.locator('td', { hasText: 'Bruno Controlador' }).waitFor();
  await shot('04-usuarios');
});

test('cadastra encomendas (inclusive várias para o mesmo lote)', async () => {
  await page.click('a[data-rota=nova]');
  await page.selectOption('#n-quadra', { label: 'Quadra 01' });
  await page.selectOption('#n-lote', { label: 'Lote 01' });
  await page.click('[data-sug="Caixa média"]');
  await page.selectOption('#n-transp', { label: 'Correios' });
  await shot('05-nova-encomenda');
  await page.click('button[type=submit].primario');
  const codigo = await page.locator('.codigo-grande').textContent();
  assert.match(codigo, new RegExp(`^FI-${todayLocal().slice(0, 4)}-00001$`));
  await shot('06-cadastro-sucesso');
  await page.click('#mesmo');
  assert.equal(await page.inputValue('#n-lote') !== '', true, 'mantém o lote');
  await page.locator('.lote-info', { hasText: '1' }).waitFor();
  await page.fill('#n-desc', 'Envelope pardo');
  await page.selectOption('#n-transp', { label: 'Shopee' });
  await page.click('button[data-outra]');
  await toast('00002');
  await page.selectOption('#n-quadra', { label: 'Quadra 02' });
  await page.selectOption('#n-lote', { label: 'Lote 02' });
  await page.fill('#n-desc', 'Caixa grande');
  await page.click('#nova-transp');
  await page.fill('#f-transp input[name=nome]', 'Jadlog');
  await page.click('#t-ok');
  await toast('Jadlog');
  assert.equal(await page.locator('#n-transp option:checked').textContent(), 'Jadlog');
  await page.click('button[type=submit].primario');
  await page.locator('.codigo-grande', { hasText: '00003' }).waitFor();
});

test('pendentes: filtra por endereço e registra retirada com assinatura', async () => {
  await page.click('a[data-rota=pendentes]');
  await page.locator('#resultado tbody tr').first().waitFor();
  assert.equal(await page.locator('#resultado tbody tr').count(), 3);
  assert.equal(await page.locator('#badge-pend').textContent(), '3');
  await shot('07-pendentes');
  await page.selectOption('#filtros select[name=quadra_id]', { label: 'Quadra 01' });
  await page.selectOption('#filtros select[name=lote_id]', { label: 'Lote 01' });
  await page.waitForFunction(() => document.querySelectorAll('#resultado tbody tr').length === 2);
  await page.locator('[data-retirar]').first().click();
  await page.fill('#form-ret input[name=retirado_por_nome]', 'Maria Moradora');
  const cv = page.locator('#pad canvas');
  const box = await cv.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 80);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 40 + i * 25, box.y + 80 + (i % 2 ? -25 : 20));
  await page.mouse.up();
  await shot('08-modal-retirada');
  await page.click('#ret-ok');
  await toast('Retirada registrada');
  await page.waitForFunction(() => document.querySelectorAll('#resultado tbody tr').length === 1);
});

test('baixa duplicada é bloqueada mesmo com a tela desatualizada', async () => {
  // simula outro computador: tela de pendentes aberta com encomenda que acabou de ser baixada por API
  await page.click('#limpar');
  await page.waitForFunction(() => document.querySelectorAll('#resultado tbody tr').length === 2);
  const id = await page.locator('#resultado tbody tr').first().getAttribute('data-id');
  const r = await page.evaluate(async (encId) => {
    const res = await fetch('/api/retiradas', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FazendaDaIlha' }, body: JSON.stringify({ encomenda_ids: [Number(encId)], retirado_por_nome: 'Outro computador' }) });
    return res.status;
  }, id);
  assert.equal(r, 201);
  await page.locator(`[data-retirar="${id}"]`).click();
  await page.fill('#form-ret input[name=retirado_por_nome]', 'Tentativa duplicada');
  await page.click('#ret-ok');
  await page.locator('#form-ret .alerta.erro', { hasText: 'Baixa duplicada bloqueada' }).waitFor();
  await shot('09-baixa-duplicada');
  await page.click('.modal [data-fechar]');
});

test('controlador: troca de senha obrigatória e retirada por outro plantão', async () => {
  await page.click('#sair');
  await page.fill('#login', 'bruno');
  await page.fill('#senha', 'Inicial12345');
  await page.click('button[type=submit]');
  await page.getByRole('heading', { name: 'Defina uma nova senha' }).waitFor();
  await page.fill('#form-senha input[name=senha_atual]', 'Inicial12345');
  await page.fill('#form-senha input[name=nova_senha]', 'Pessoal98765');
  await page.fill('#form-senha input[name=nova_senha2]', 'Pessoal98765');
  await page.click('#senha-ok');
  await toast('Senha alterada');
  assert.equal(await page.locator('a[data-rota=usuarios]').count(), 0, 'controlador não vê menu de usuários');

  await page.click('a[data-rota=pendentes]');
  await page.locator('#resultado tbody tr').first().waitFor();
  await page.locator('[data-outro]').first().click();
  await page.locator('.modal-head.roxo').waitFor();
  // tenta concluir sem observação
  await page.fill('#form-ret input[name=data]', todayLocal());
  await page.fill('#form-ret input[name=retirado_por_nome]', 'Vizinho do lote');
  await page.selectOption('#form-ret select[name=entregador]', 'desconhecido');
  await page.fill('#form-ret input[name=plantao]', 'Plantão noturno');
  await page.click('#ret-ok');
  await page.locator('#form-ret .alerta.erro', { hasText: 'observação' }).waitFor();
  assert.equal(await page.locator('#form-ret select[name=entregador] option', { hasText: 'Bruno Controlador' }).count(), 0, 'usuário logado não aparece como entregador');
  await page.fill('#form-ret textarea[name=observacoes]', 'Morador informou que retirou no plantão anterior.');
  await shot('10-modal-outro-plantao');
  await page.click('#ret-ok');
  await toast('outro plantão');
  await page.locator('.vazio', { hasText: 'Nenhuma encomenda pendente' }).waitFor();
});

test('histórico e ficha completa', async () => {
  await page.click('a[data-rota=historico]');
  await page.locator('#resultado tbody tr').first().waitFor();
  assert.equal(await page.locator('#resultado tbody tr').count(), 3, 'nenhuma encomenda desaparece após a retirada');
  await page.fill('#filtros input[name=q]', 'Caixa grande');
  await page.waitForFunction(() => document.querySelectorAll('#resultado tbody tr').length === 1);
  await shot('11-historico');
  await page.locator('#resultado tbody tr').first().click();
  await page.locator('.faixa-outro', { hasText: 'RETIRADA REALIZADA POR OUTRO PLANTÃO' }).waitFor();
  const ficha = await page.locator('#conteudo').textContent();
  assert.match(ficha, /Lançado por\s*Bruno Controlador/);
  assert.match(ficha, /Controlador que entregou\s*não identificado/);
  assert.match(ficha, /Plantão noturno/);
  assert.match(ficha, /Retirada por outro plantão lançada/);
  await shot('12-ficha-outro-plantao');
});

test('ficha de retirada própria mostra assinatura e permite corrigir (admin)', async () => {
  await page.click('#sair');
  await page.fill('#login', 'admin');
  await page.fill('#senha', 'SenhaForte123');
  await page.click('button[type=submit]');
  await page.click('a[data-rota=historico]');
  await page.fill('#filtros input[name=q]', 'Maria');
  await page.waitForFunction(() => document.querySelectorAll('#resultado tbody tr').length === 1);
  await page.locator('#resultado tbody tr').first().click();
  await page.locator('.anexo img').waitFor();
  const ok = await page.locator('.anexo img').evaluate((img) => img.complete && img.naturalWidth > 0);
  assert.ok(ok, 'assinatura carregada');
  await page.click('#a-editar');
  await page.fill('#f-ed input[name=descricao]', 'Caixa média parda');
  await page.click('#ed-ok');
  await page.locator('#f-ed .alerta.erro', { hasText: 'justificativa' }).waitFor();
  await page.fill('#f-ed input[name=justificativa]', 'Detalhar descrição');
  await page.click('#ed-ok');
  await toast('Correção registrada');
  await page.locator('.diff', { hasText: 'Caixa média parda' }).waitFor();
  await shot('13-ficha-retirada-propria');
});

test('relatórios: visualizar e exportar PDF e Excel', async () => {
  await page.click('a[data-rota=relatorios]');
  await page.click('#ver');
  await page.locator('#res tbody tr').first().waitFor();
  assert.equal(await page.locator('#res tbody tr').count(), 3);
  await shot('14-relatorios');
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pdf')]);
  assert.match(dl.suggestedFilename(), /\.pdf$/);
  const pdf = fs.readFileSync(await dl.path());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  if (SHOTS) fs.copyFileSync(await dl.path(), path.join(SHOTS, 'relatorio.pdf'));
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xlsx')]);
  assert.match(dl.suggestedFilename(), /\.xlsx$/);
  await page.click('#ver-f');
  await page.locator('#res-f td', { hasText: 'Bruno Controlador' }).waitFor();
});

test('dashboard e auditoria refletem as operações', async () => {
  await page.click('a[data-rota=dashboard]');
  await page.locator('.kpi.pend .val').waitFor();
  assert.equal(await page.locator('.kpi.pend .val').textContent(), '0');
  assert.equal(await page.locator('.kpi.hoje .val').textContent(), '3');
  assert.equal(await page.locator('.kpi.ret .val').textContent(), '2');
  assert.equal(await page.locator('.kpi.outro .val').textContent(), '1');
  await shot('15-dashboard');
  await page.click('a[data-rota=auditoria]');
  await page.locator('#res-aud tbody tr').first().waitFor();
  const txt = await page.locator('#res-aud').textContent();
  for (const a of ['Encomenda cadastrada', 'Baixa (retirada)', 'Retirada de outro plantão lançada', 'Encomenda corrigida']) assert.ok(txt.includes(a), a);
  await shot('16-auditoria');
});

test('layout responsivo no celular', async () => {
  const ctx = page.context();
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(srv.base + '/#/historico');
  await m.locator('#resultado tbody tr').first().waitFor();
  const largura = await m.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(largura <= 392, `sem rolagem horizontal (largura ${largura})`);
  await shot('17-celular-historico', m);
  await m.click('#menu-btn');
  await shot('18-celular-menu', m);
  await m.close();
});

test('nenhum erro de JavaScript durante o uso', () => {
  assert.deepEqual(erros, []);
});
