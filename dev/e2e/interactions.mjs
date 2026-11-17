/**
 * End-to-end checks in the test Studio: edits made through the tree must reach the Content Lake
 * as targeted patches, and leave the rest of the document alone.
 *
 * Needs the fake lake (`node dev/fake-lake/server.mjs`) and a Studio (`sanity dev` in dev/).
 *
 * Usage: node dev/e2e/interactions.mjs [studioUrl]
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {chromium} = require('playwright')

const studioUrl = process.argv[2] ?? 'http://localhost:3333'
// Node can't resolve *.localhost; the fake lake answers on any host name
const LAKE = `https://localhost:${process.env.FAKE_LAKE_PORT || 3334}`
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const lake = {
  reset: () => fetch(`${LAKE}/__fake/reset`, {method: 'POST'}),
  transactions: () => fetch(`${LAKE}/__fake/transactions`).then((res) => res.json()),
  doc: (id) => fetch(`${LAKE}/__fake/doc/${id}`).then((res) => res.json()),
}

/** All patch operations sent so far, flattened from mutations and edit actions */
async function sentPatches() {
  const transactions = await lake.transactions()
  return transactions.flatMap((tx) =>
    tx.endpoint === 'actions'
      ? tx.actions.filter((a) => a.patch).map((a) => a.patch)
      : tx.mutations.filter((m) => m.patch).map((m) => m.patch),
  )
}

async function waitFor(check, message, timeout = 15000) {
  const start = Date.now()
  for (;;) {
    const result = await check()
    if (result) return result
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${message}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const keys = (items) => (items ?? []).map((item) => item._key)

/** The innermost tree row (`li`) showing `text` */
const rowOf = (field, text) =>
  field.getByText(text, {exact: true}).first().locator('xpath=ancestor::li[1]')

const tests = {
  'removes an item with a single unset': async (page, field) => {
    const row = rowOf(field, 'Sale')
    await row.getByText('Sale', {exact: true}).first().hover()
    await row.locator('button').last().click()

    const draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc && !keys(doc.items[1].children).includes('sale') && doc
    }, 'Sale removed from the draft')

    assert.deepEqual(keys(draft.items), ['home', 'shop', 'about', 'contact'])
    assert.deepEqual(keys(draft.items[1].children), ['women', 'men'])
    assert.deepEqual(keys(draft.items[1].children[0].children), ['dresses', 'shoes'])

    const patches = await sentPatches()
    assert.ok(
      patches.some((patch) => patch.unset?.includes('items[_key=="shop"].children[_key=="sale"]')),
      `expected a targeted unset, got ${JSON.stringify(patches)}`,
    )
    assert.ok(
      !patches.some((patch) => patch.set && Object.keys(patch.set).some((p) => p === 'items')),
      'the whole array must not be set',
    )
  },

  'moves an item into another parent with unset + insert': async (page, field) => {
    const handle = rowOf(field, 'Contact').locator('button').first()
    const target = rowOf(field, 'Team')
    const from = await handle.boundingBox()
    const to = await target.boundingBox()

    // Drag "Contact" just below "Team" and one level in, so it becomes a child of "About"
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 20, from.y - 10, {steps: 5})
    await page.mouse.move(to.x + 10, to.y + to.height - 4, {steps: 20})
    await page.waitForTimeout(300)
    await page.mouse.up()

    const draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc && !keys(doc.items).includes('contact') && doc
    }, 'Contact moved out of the root')

    const about = draft.items.find((item) => item._key === 'about')
    assert.ok(
      keys(about.children).includes('contact'),
      `Contact under About: ${JSON.stringify(about)}`,
    )
    assert.equal(about.children.find((c) => c._key === 'contact').url, '/contact')

    const patches = await sentPatches()
    assert.ok(patches.some((patch) => patch.unset?.includes('items[_key=="contact"]')))
    assert.ok(patches.some((patch) => patch.insert))
  },

  'adds an item with an insert': async (page, field) => {
    await field.getByRole('button', {name: 'Add item'}).last().click()

    const draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc && doc.items.length === 5 && doc
    }, 'a fifth root item')

    assert.deepEqual(keys(draft.items).slice(0, 4), ['home', 'shop', 'about', 'contact'])
    assert.equal(draft.items[4]._type, 'menuItem')
    const patches = await sentPatches()
    assert.ok(patches.some((patch) => patch.insert?.after === 'items[-1]'))
  },

  'adds the item type picked from the menu': {
    doc: ['mixedMenu', 'menu-mixed'],
    run: async (page, field) => {
      await field.getByRole('button', {name: 'Add item'}).last().click()
      await page.getByRole('menuitem', {name: 'Divider'}).click()

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-mixed')
        return doc && doc.items.length === 4 && doc
      }, 'a fourth root item')

      assert.equal(draft.items[3]._type, 'menuDivider')
    },
  },

  'opens nested items in the Studio dialog': async (page, field) => {
    await field.getByText('Dresses', {exact: true}).first().click()
    const dialog = page.getByRole('dialog').last()
    await dialog.waitFor()
    await waitFor(
      async () => (await dialog.locator('input').first().inputValue()) === 'Dresses',
      'the dialog to show the Dresses item',
    )
  },
}

async function run() {
  const browser = await chromium.launch()
  let failed = 0

  for (const [name, entry] of Object.entries(tests)) {
    const {doc: [type, id] = ['menu', 'menu-main'], run: test} =
      typeof entry === 'function' ? {run: entry} : entry
    await lake.reset()
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: {width: 1100, height: 1400},
    })
    const page = await context.newPage()
    await page.goto(`${studioUrl}/structure/${type};${id}`)
    const field = page.locator('[data-testid="field-items"]')
    await field.getByText('Home', {exact: true}).first().waitFor({timeout: 120000})
    await page.waitForTimeout(1500)

    try {
      await test(page, field)
      console.log(`ok   ${name}`)
    } catch (error) {
      failed += 1
      console.log(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`)
      await page.screenshot({path: `interaction-failure-${failed}.png`})
    }
    await context.close()
  }

  await browser.close()
  process.exit(failed ? 1 : 0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
