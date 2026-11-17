/**
 * Measures how smooth dragging is in the test Studio: frame times and long tasks during a scripted
 * pointer drag, plus how long the tree takes to render. Runs with CPU throttling to approximate a
 * slower machine.
 *
 * Needs the test Studio running (`npm run dev`).
 *
 * Usage: node dev/e2e/perf.mjs [studioUrl] [cpuThrottling=4] [--warm]
 *   --warm: drag and drop once (unmeasured) before the measured drag, so the measurement leaves out
 *   first-interaction costs (the document's first edit, first styles, JIT warm-up)
 */
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {chromium} = require('playwright')

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const warm = process.argv.includes('--warm')
const studioUrl = args[0] ?? 'http://localhost:3333'
const throttling = Number(args[1] ?? 4)
const LAKE = `https://localhost:${process.env.FAKE_LAKE_PORT || 3334}`
// The fake lake uses a self-signed certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const cases = [
  // The last row: nothing moves out of its way, so this mostly measures pointer tracking
  {name: 'main menu (11 items)', doc: 'menu-main', drag: 'Contact', rows: 6},
  // The first row, down past 6 rows and back: the tree re-renders and rows slide
  {name: 'main menu, reorder (11 items)', doc: 'menu-main', drag: 'Home', rows: 6, warmUpBy: 1},
  {name: '500 items', doc: 'menu-big', drag: 'Group 3', rows: 8},
]

const handleOf = (field, title) =>
  field
    .getByText(title, {exact: true})
    .first()
    .locator('xpath=ancestor::li[1]')
    .locator('button')
    .first()

/**
 * Drags the row one row up (or `by` rows down) and drops it there, unmeasured, so the measured drag
 * isn't the first interaction and its drop isn't the document's first edit
 */
async function warmUp(page, handle, by = -1) {
  const box = await handle.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + 5, y + (i / 10) * by * 55)
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(1500)
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  return {p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0}
}

async function run() {
  const browser = await chromium.launch()
  const results = []

  for (const testCase of cases) {
    await fetch(`${LAKE}/__fake/reset`, {method: 'POST'})
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: {width: 1100, height: 1400},
    })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)

    const start = Date.now()
    await page.goto(`${studioUrl}/structure/menu;${testCase.doc}`)
    const field = page.locator('[data-testid="field-items"]')
    await field.getByText(testCase.drag, {exact: true}).first().waitFor({timeout: 180000})
    const renderMs = Date.now() - start
    await page.waitForTimeout(2000)
    if (warm) await warmUp(page, handleOf(field, testCase.drag), testCase.warmUpBy)

    await cdp.send('Emulation.setCPUThrottlingRate', {rate: throttling})

    // Record frame intervals and long tasks while dragging
    await page.evaluate(() => {
      window.__perf = {frames: [], longTasks: []}
      let last = performance.now()
      const tick = (now) => {
        window.__perf.frames.push(now - last)
        last = now
        if (window.__perf.running !== false) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perf.longTasks.push({start: entry.startTime, duration: entry.duration})
        }
      }).observe({type: 'longtask', buffered: false})
    })
    const mark = (name) =>
      page.evaluate((key) => {
        window.__perf[key] = performance.now()
      }, name)

    const handle = handleOf(field, testCase.drag)
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.waitForTimeout(500)
    await mark('down')
    await page.mouse.down()
    // Down over `rows` rows (~55px each) and back up, in small steps like a real pointer
    for (let i = 1; i <= 60; i++) await page.mouse.move(x + 5, y + (i / 60) * testCase.rows * 55)
    for (let i = 59; i >= 0; i--) await page.mouse.move(x + 5, y + (i / 60) * testCase.rows * 55)
    // Drop one row lower than it started, so the drop writes a change
    await page.mouse.move(x + 5, y + 55)
    await page.waitForTimeout(300)
    await mark('drop')
    await page.mouse.up()
    await page.waitForTimeout(1500)

    const perf = await page.evaluate(() => {
      window.__perf.running = false
      return window.__perf
    })
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1})

    const frames = perf.frames.slice(1)
    const tasksBetween = (from, to) =>
      Math.round(
        perf.longTasks
          .filter((task) => task.start >= from && task.start < to)
          .reduce((sum, task) => sum + task.duration, 0),
      )
    results.push({
      case: warm ? `${testCase.name}, warm` : testCase.name,
      renderMs,
      frames: frames.length,
      frameMs: stats(frames),
      framesOver50ms: frames.filter((ms) => ms > 50).length,
      longTaskMs: Math.round(perf.longTasks.reduce((sum, task) => sum + task.duration, 0)),
      longTasks: perf.longTasks.length,
      // Long tasks in the first 600ms after pointer down, and after the drop
      dragStartMs: tasksBetween(perf.down, perf.down + 600),
      dropMs: tasksBetween(perf.drop, Number.POSITIVE_INFINITY),
    })
    await context.close()
  }

  await browser.close()
  for (const r of results) {
    console.log(
      `${r.case}: initial render ${r.renderMs}ms | drag frames p50 ${r.frameMs.p50.toFixed(1)}ms p95 ${r.frameMs.p95.toFixed(1)}ms max ${r.frameMs.max.toFixed(0)}ms, ${r.framesOver50ms}/${r.frames} frames >50ms | long tasks ${r.longTasks} (${r.longTaskMs}ms) | drag start ${r.dragStartMs}ms, drop ${r.dropMs}ms`,
    )
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
