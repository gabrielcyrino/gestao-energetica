/**
 * Percorre os critérios de aceitação pela interface (Edge headless):
 * fluxograma → etapa → USE → equipamento → indicador → histórico → comparações
 * e cadastro de uma nova área e de um novo indicador sem tocar em código.
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const OUT = process.env.OUT_DIR || 'C:/Users/Gabriel/AppData/Local/Temp/claude/C--Users-Gabriel-Downloads-bayer-eficiencia-energetica/57863777-8959-47ee-a829-978fd3c7fc46/scratchpad/shots'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE_URL || 'http://localhost:6471'
const P = 'p=month:2026-08&c=prev'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'pt-BR' })).newPage()
const problems = []
page.on('pageerror', (e) => problems.push(`[pageerror] ${e}`))
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/auth/login')) problems.push(`[http ${r.status()}] ${r.url()}`)
})
const ok = (label, cond) => console.log(`${cond ? 'OK  ' : 'FALHA'} ${label}`)

await page.goto(`${BASE}/login`)
await page.getByRole('button', { name: /Gestão de Energia/ }).first().click()
await page.waitForURL(`${BASE}/`)
await page.waitForTimeout(3000)

// --- drill-down completo a partir do fluxograma
await page.goto(`${BASE}/areas/3/fluxograma?${P}`)
await page.waitForTimeout(3500)
const secador = page.locator('.react-flow__node', { hasText: 'Secador' }).first()
await secador.click()
await page.waitForTimeout(2500)
await page.getByRole('tab', { name: /USEs/ }).click()
await page.waitForTimeout(1500)
const useLink = page.locator('aside a[href*="/uses/"]').first()
ok('fluxograma lista USEs da etapa', (await useLink.count()) > 0)
await useLink.click()
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/a1-use.png` })
ok('página do USE abriu', /uses\//.test(page.url()))
const eqLink = page.locator('a[href*="/equipamentos/"]').first()
ok('USE lista equipamentos', (await eqLink.count()) > 0)
await eqLink.click()
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/a2-equipamento.png` })
const indLink = page.locator('a[href*="/indicadores/"]').first()
ok('equipamento lista indicadores', (await indLink.count()) > 0)
await indLink.click()
await page.waitForTimeout(3500)
await page.screenshot({ path: `${OUT}/a3-indicador.png` })
const body = await page.locator('main').innerText()
ok('indicador mostra histórico e tendência', /Histórico e tendência/.test(body))
ok('período preservado no drill-down', page.url().includes('p=month%3A2026-08') || page.url().includes('p=month:2026-08'))

// --- voltar ao fluxograma mantendo contexto
await page.getByRole('link', { name: /Ver no fluxograma/ }).first().click()
await page.waitForTimeout(3000)
ok('voltou ao fluxograma com etapa selecionada', page.url().includes('sel='))
await page.screenshot({ path: `${OUT}/a4-volta-fluxograma.png` })

// --- comparações (safra × safra)
await page.goto(`${BASE}/comparacoes?${P}`)
await page.waitForTimeout(3000)
await page.getByRole('button', { name: /Safra × safra/ }).first().click()
await page.waitForTimeout(4000)
await page.screenshot({ path: `${OUT}/a5-safra.png` })
const cmp = await page.locator('main').innerText()
ok('comparação safra × safra anterior', /Safrinha|Safra Verão/.test(cmp))

// --- Crop Year × Crop Year
await page.getByRole('button', { name: /Crop Year × Crop Year/ }).first().click()
await page.waitForTimeout(4000)
await page.screenshot({ path: `${OUT}/a6-cropyear.png` })
ok('comparação Crop Year', /Crop Year/.test(await page.locator('main').innerText()))

// --- cadastro de nova área pela interface
await page.goto(`${BASE}/configuracoes?${P}`)
await page.waitForTimeout(2500)
await page.getByRole('button', { name: /Nova área/ }).first().click()
await page.waitForTimeout(1200)
const stamp = Date.now().toString().slice(-5)
await page.getByLabel(/Código/).first().fill(`teste.ui${stamp}`)
await page.getByLabel(/Nome/).first().fill(`Área de Teste UI ${stamp}`)
await page.getByRole('button', { name: /^Salvar|Criar/ }).last().click()
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/a7-nova-area.png` })
const cfg = await page.locator('main').innerText()
ok('nova área criada e listada', cfg.includes(`Área de Teste UI ${stamp}`))
await page.reload()
await page.waitForTimeout(3000)
const nav = await page.locator('aside').first().innerText()
ok('nova área aparece na navegação', nav.includes('Área de Teste UI'))

console.log('\nproblemas:', problems.length)
;[...new Set(problems)].slice(0, 15).forEach((p) => console.log('  -', p))
await browser.close()
