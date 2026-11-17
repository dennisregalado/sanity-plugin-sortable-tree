/**
 * Captures screenshots of the tree input in the test Studio, for reviewing visual changes.
 *
 * Needs the fake lake (`node dev/fake-lake/server.mjs`) and a Studio (`sanity dev` in dev/).
 *
 * Usage: node dev/e2e/screenshots.mjs <outDir> [studioUrl] [scenario...]
 */
import {mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {chromium} = require('playwright')

const [outDir = 'screenshots', studioUrl = 'http://localhost:3333', ...only] = process.argv.slice(2)
// Node can't resolve *.localhost; the fake lake answers on any host name
const LAKE = `https://localhost:${process.env.FAKE_LAKE_PORT || 3334}`
// The fake lake uses a self-signed certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const docUrl = (type, id) => `${studioUrl}/structure/${type};${id}`

/** Each scenario opens a document, optionally interacts, and returns what to capture */
const scenarios = {
  'main': {url: docUrl('menu', 'menu-main')},
  'main-hover': {
    url: docUrl('menu', 'menu-main'),
    async act(page, field) {
      await field.getByText('Shop', {exact: true}).first().hover()
    },
  },
  'main-hover-leaf': {
    url: docUrl('menu', 'menu-main'),
    async act(page, field) {
      await field.getByText('Home', {exact: true}).first().hover()
    },
  },
  'main-collapsed-all': {
    url: docUrl('menu', 'menu-main'),
    async act(page, field) {
      await field.getByRole('button', {name: 'Collapse all'}).click()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(700)
    },
  },
  'main-collapsed': {
    url: docUrl('menu', 'menu-main'),
    async act(page, field) {
      // the collapse button sits right before the "Shop" preview
      const row = field.locator('li', {hasText: 'Shop'}).first()
      await row.locator('button').nth(1).click()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(600)
    },
  },
  'main-dragging': {
    url: docUrl('menu', 'menu-main'),
    async act(page, field) {
      const row = field.locator('li', {hasText: 'Contact'}).first()
      const handle = row.locator('button').first()
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 10, box.y - 20, {steps: 5})
      await page.mouse.move(box.x + box.width / 2 + 60, box.y - 120, {steps: 10})
      await page.waitForTimeout(400)
    },
    async after(page) {
      await page.mouse.up()
    },
  },
  'main-focus': {
    url: docUrl('menu', 'menu-main'),
    async act(page, field) {
      // Tab from the drag handle to the row's main button, like a keyboard user
      const row = field.getByText('Shop', {exact: true}).first().locator('xpath=ancestor::li[1]')
      await row.locator('button').first().focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.waitForTimeout(300)
    },
  },
  'main-touch': {
    url: docUrl('menu', 'menu-main'),
    context: {isMobile: true, hasTouch: true},
  },
  'main-keyboard-pickup': {
    url: docUrl('menu', 'menu-main'),
    async act(page, field) {
      const row = field.getByText('Contact', {exact: true}).first().locator('xpath=ancestor::li[1]')
      await row.locator('button').first().focus()
      await page.keyboard.press('Space')
      await page.waitForTimeout(500)
    },
    async after(page) {
      await page.keyboard.press('Escape')
    },
  },
  'main-keyboard': {
    url: docUrl('menu', 'menu-main'),
    async act(page, field) {
      // Mid keyboard drag: "Contact" picked up and moved up two positions
      const row = field.getByText('Contact', {exact: true}).first().locator('xpath=ancestor::li[1]')
      await row.locator('button').first().focus()
      for (const key of ['Space', 'ArrowUp', 'ArrowUp']) {
        await page.keyboard.press(key)
        await page.waitForTimeout(300)
      }
      await page.waitForTimeout(400)
    },
    async after(page) {
      await page.keyboard.press('Escape')
    },
  },
  'main-dialog': {
    url: docUrl('menu', 'menu-main'),
    viewport: true,
    async act(page, field) {
      await field.getByText('Women', {exact: true}).first().click()
      await page.getByRole('dialog').first().waitFor()
      await page.waitForTimeout(600)
    },
  },
  'empty': {url: docUrl('menu', 'menu-empty')},
  'validation': {url: docUrl('menu', 'menu-validation')},
  'validation-collapsed': {
    url: docUrl('menu', 'menu-validation'),
    async act(page, field) {
      // Collapse "About": its hidden child's error shows on the "About" row
      const row = field.getByText('About', {exact: true}).first().locator('xpath=ancestor::li[1]')
      await row.locator('button').nth(1).click()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(600)
    },
  },
  'options': {url: docUrl('optionsMenu', 'menu-options')},
  'options-hover': {
    url: docUrl('optionsMenu', 'menu-options'),
    async act(page, field) {
      await field.getByText('Shop', {exact: true}).first().hover()
    },
  },
  'readonly': {url: docUrl('readOnlyMenu', 'menu-readonly')},
  'named': {url: docUrl('namedMenu', 'menu-named')},
  'mixed': {url: docUrl('mixedMenu', 'menu-mixed')},
  'mixed-menu': {
    url: docUrl('mixedMenu', 'menu-mixed'),
    viewport: true,
    async act(page, field) {
      await field.getByRole('button', {name: 'Add item'}).last().click()
      await page.getByRole('menuitem').first().waitFor()
      await page.waitForTimeout(400)
    },
  },
  'malformed': {url: docUrl('menu', 'menu-malformed')},
}

async function run() {
  mkdirSync(outDir, {recursive: true})
  const browser = await chromium.launch()
  const names = only.length ? only : Object.keys(scenarios)

  for (const scheme of ['light', 'dark']) {
    for (const name of names) {
      const scenario = scenarios[name]
      const reset = await fetch(`${LAKE}/__fake/reset`, {method: 'POST'})
      if (!reset.ok) throw new Error(`Could not reset the fake lake: ${reset.status}`)
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: {width: 1100, height: 1400},
        deviceScaleFactor: 2,
        colorScheme: scheme,
        ...scenario.context,
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(scenario.url)
      const field = page.locator('[data-testid="field-items"]')
      await field.waitFor({timeout: 120000})
      // Previews resolve asynchronously. (Not 'networkidle': listener streams never go idle.)
      await field.locator('li, [data-ui="Text"]').first().waitFor()
      await page.waitForTimeout(2000)
      // keep the caret and toasts out of the picture
      await page.addStyleTag({content: '*{caret-color:transparent!important}'})
      await page.mouse.move(0, 0)

      if (scenario.act) await scenario.act(page, field)
      const file = `${outDir}/${name}.${scheme}.png`
      await (scenario.viewport ? page.screenshot({path: file}) : field.screenshot({path: file}))
      if (scenario.after) await scenario.after(page)
      console.log(`${file}${errors.length ? `  page errors: ${errors.join(' | ')}` : ''}`)
      await context.close()
    }
  }
  await browser.close()
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
