import { chromium } from 'playwright-core'
import fs from 'node:fs'

const OUT = process.argv[2] || 'C:/Users/Gabriel/AppData/Local/Temp/claude/C--Users-Gabriel-Downloads-bayer-eficiencia-energetica/57863777-8959-47ee-a829-978fd3c7fc46/scratchpad/shots'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE_URL || 'http://localhost:6471'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'pt-BR' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`))
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url().replace(BASE, '')}`)
})

async function shot(name, { wait = 2500 } = {}) {
  await page.waitForTimeout(wait)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
  const heading = await page.locator('h1').first().textContent().catch(() => null)
  console.log(`  ${name}: h1="${(heading || '').trim().slice(0, 60)}"`)
}

console.log('== login')
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await shot('01-login', { wait: 800 })
await page.getByRole('button', { name: /Gestão de Energia/ }).first().click()
await page.waitForURL(`${BASE}/`, { timeout: 15000 })
console.log('== dashboard')
await page.waitForTimeout(4000)
await shot('02-dashboard', { wait: 1500 })
const kpi = await page.locator('main').innerText()
console.log('  KPIs contém "Consumo total":', kpi.includes('Consumo total'))

// Recebimento
console.log('== área Recebimento')
await page.getByRole('button', { name: 'Recebimento' }).first().click()
await page.getByRole('link', { name: 'Visão geral' }).first().click()
await page.waitForTimeout(3500)
await shot('03-area-recebimento')

console.log('== fluxograma')
await page.getByRole('link', { name: /Fluxograma/ }).first().click()
await page.waitForTimeout(4000)
await shot('04-fluxograma')
const flowText = await page.locator('main').innerText()
for (const step of ['Despalha', 'Debulha', 'Secador', 'Caldeira']) {
  console.log(`  etapa ${step}:`, flowText.includes(step))
}
// clicar em Secador no canvas
const secador = page.locator('.react-flow__node', { hasText: 'Secador' }).first()
if (await secador.count()) {
  await secador.click()
  await page.waitForTimeout(2500)
  await shot('05-fluxograma-secador')
  const panel = await page.locator('aside').last().innerText()
  console.log('  painel mostra USEs/indicadores:', /USE|Indicador/i.test(panel))
  // aba indicadores
  const tabInd = page.getByRole('tab', { name: /Indicadores/ }).first()
  if (await tabInd.count()) {
    await tabInd.click()
    await page.waitForTimeout(2500)
    await shot('06-fluxograma-indicadores')
  }
}

console.log('== processo Secador')
await page.goto(`${BASE}/processos/7?p=month:2026-08&c=prev`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await shot('07-processo-secador')

console.log('== indicador')
const indLink = page.locator('a[href*="/indicadores/"]').first()
if (await indLink.count()) {
  await indLink.click()
  await page.waitForTimeout(4000)
  await shot('08-indicador')
  for (const tab of ['Energia × produção', 'Observado × esperado', 'Definição e fórmula', 'Qualidade do dado']) {
    const t = page.getByRole('tab', { name: new RegExp(tab.split(' ')[0]) }).first()
    if (await t.count()) {
      await t.click()
      await page.waitForTimeout(2200)
      await shot(`09-indicador-${tab.split(' ')[0].toLowerCase()}`)
    }
  }
}

const routes = [
  ['10-uses', '/uses'],
  ['11-indicadores', '/indicadores'],
  ['12-comparacoes', '/comparacoes'],
  ['13-tendencias', '/tendencias'],
  ['14-oportunidades', '/oportunidades'],
  ['15-qualidade', '/qualidade'],
  ['16-configuracoes', '/configuracoes'],
  ['17-metodologia', '/metodologia'],
  ['18-torre-fluxo', '/areas/4/fluxograma'],
  ['19-torre', '/areas/4'],
]
for (const [name, path] of routes) {
  console.log(`== ${path}`)
  await page.goto(`${BASE}${path}?p=month:2026-08&c=prev`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3800)
  await shot(name, { wait: 600 })
}

// tema escuro
await page.goto(`${BASE}/?p=month:2026-08&c=prev`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
await page.getByRole('button', { name: 'Alternar tema' }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Alternar tema' }).click()
await page.waitForTimeout(2500)
await shot('20-dashboard-dark')

console.log('\n== erros capturados:', errors.length)
const unique = [...new Set(errors)]
unique.slice(0, 40).forEach((e) => console.log('  -', e))
await browser.close()
