/**
 * End-to-end checks in the test Studio: edits made through the tree must reach the Content Lake
 * as targeted patches, and leave the rest of the document alone.
 *
 * Needs the fake lake (`node dev/fake-lake/server.mjs`) and a Studio (`sanity dev` in dev/).
 *
 * Usage: node dev/e2e/interactions.mjs [studioUrl] [test name filter]
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {chromium} = require('playwright')

const studioUrl = process.argv[2] ?? 'http://localhost:3333'
const only = process.argv[3]
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

/** Picks an action from the item menu (⋯) of the row showing `text` */
async function rowMenuAction(page, field, text, action) {
  // The row's own menu comes first: the rows nested inside it follow
  await rowOf(field, text).getByTestId('array-item-menu-button').first().click()
  await page.getByRole('menuitem', {name: action, exact: true}).click()
}

/** Closes the edit dialogs, innermost first */
async function closeDialogs(page) {
  for (let i = 0; i < 5 && (await page.getByRole('dialog').count()) > 0; i++) {
    await page.getByRole('dialog').last().getByRole('button', {name: 'Close dialog'}).click()
    await page.waitForTimeout(400)
  }
}

const SHOP = 'items[_key=="shop"].children'
const WOMEN = `${SHOP}[_key=="women"]`

const tests = {
  'removes an item with a single unset': async (page, field) => {
    await rowMenuAction(page, field, 'Sale', 'Remove')

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

  'reorders with the keyboard, one position per arrow key': async (page, field) => {
    const handle = rowOf(field, 'Contact').locator('button').first()
    await handle.focus()
    // Pick up, move up past "Team" and "About" (staying nested), then outdent to the root
    for (const key of ['Space', 'ArrowUp', 'ArrowUp', 'ArrowLeft', 'Space']) {
      await page.keyboard.press(key)
      await page.waitForTimeout(300)
    }

    const draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc && keys(doc.items).indexOf('contact') === 2 && doc
    }, 'Contact moved above About')

    assert.deepEqual(keys(draft.items), ['home', 'shop', 'contact', 'about'])
    assert.deepEqual(keys(draft.items[3].children), ['team'])
  },

  'adds a nested item to an item without children': async (page, field) => {
    const row = rowOf(field, 'Home')
    await row.getByText('Home', {exact: true}).first().hover()
    await row.getByRole('button', {name: 'Add nested item'}).click()

    const draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc && doc.items[0].children?.length === 1 && doc
    }, 'a child under Home')

    assert.equal(draft.items[0].children[0]._type, 'menuItem')
    assert.deepEqual(keys(draft.items), ['home', 'shop', 'about', 'contact'])
  },

  'collapses and expands everything': async (page, field) => {
    const dresses = field.getByText('Dresses', {exact: true}).first()
    await field.getByRole('button', {name: 'Collapse all'}).click()
    await waitFor(async () => !(await dresses.isVisible()), 'nested items hidden')
    await field.getByRole('button', {name: 'Expand all'}).click()
    await waitFor(() => dresses.isVisible(), 'nested items shown again')

    // Expanding and collapsing is view state: nothing is written
    assert.equal(await lake.doc('drafts.menu-main'), null)
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

  'long trees mount rows as they scroll into view': {
    doc: ['menu', 'menu-big'],
    run: async (page, field) => {
      const last = field.getByText('Group 100', {exact: true}).first()
      // Off-screen rows are placeholders until they come near the viewport: scroll down to it
      await page.mouse.move(700, 700)
      for (let i = 0; i < 80 && !(await last.isVisible()); i++) {
        await page.mouse.wheel(0, 1200)
        await page.waitForTimeout(150)
      }
      assert.ok(await last.isVisible(), 'the last group rendered after scrolling')

      // Let the rows that just mounted settle before using the menu
      await page.waitForTimeout(800)
      await rowMenuAction(page, field, 'Group 100', 'Remove')

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-big')
        return doc && doc.items.length === 99 && doc
      }, 'Group 100 removed')
      assert.equal(draft.items.at(-1)._key, 'g98')
      const patches = await sentPatches()
      assert.ok(patches.some((patch) => patch.unset?.includes('items[_key=="g99"]')))
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

  'opens a nested item in one dialog per level': async (page, field) => {
    await field.getByText('Dresses', {exact: true}).first().click()
    await page.getByRole('dialog').last().waitFor()
    await page.waitForTimeout(800)

    // Shop's row hosts the dialog: Shop > Women > Dresses, each once (not twice)
    const titleInputs = await page
      .getByRole('dialog')
      .evaluateAll((dialogs) =>
        dialogs.map((dialog) => dialog.querySelector('input')?.value ?? null),
      )
    assert.deepEqual(titleInputs.filter(Boolean), ['Shop', 'Women', 'Dresses'])
  },

  'duplicates a nested item next to it, with new keys': async (page, field) => {
    await rowMenuAction(page, field, 'Women', 'Duplicate')

    const draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc && doc.items[1].children.length === 4 && doc
    }, 'a copy of Women under Shop')

    const shop = draft.items[1]
    const copy = shop.children[1]
    assert.deepEqual(
      keys(shop.children).filter((key) => key !== copy._key),
      ['women', 'men', 'sale'],
    )
    assert.equal(copy.title, 'Women')
    assert.equal(copy.children.length, 2)
    assert.ok(!['women', 'dresses', 'shoes'].includes(copy._key), 'the copy has new keys')
    assert.ok(!keys(copy.children).some((key) => ['dresses', 'shoes'].includes(key)))
    assert.deepEqual(keys(draft.items), ['home', 'shop', 'about', 'contact'])

    const patches = await sentPatches()
    assert.ok(
      patches.some((patch) => patch.insert?.after === WOMEN),
      `expected an insert after Women, got ${JSON.stringify(patches)}`,
    )
    // The copy opens in the dialog
    await page.getByRole('dialog').last().waitFor()
  },

  'adds an item before and after a nested item': async (page, field) => {
    await rowMenuAction(page, field, 'Shoes', 'Add item before')
    let draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc?.items[1].children[0].children.length === 3 && doc
    }, 'an item before Shoes')
    const women = draft.items[1].children[0]
    assert.equal(women.children[0]._key, 'dresses')
    assert.equal(women.children[1]._type, 'menuItem')
    assert.equal(women.children[2]._key, 'shoes')

    // The new item opens in Shop's dialog. Closing it removes it again, since it's still empty.
    await page.getByRole('dialog').last().waitFor()
    await closeDialogs(page)

    await rowMenuAction(page, field, 'Men', 'Add item after')
    draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc?.items[1].children.length === 4 && doc
    }, 'an item after Men')
    assert.deepEqual(keys(draft.items[1].children).slice(0, 2), ['women', 'men'])
    assert.equal(draft.items[1].children[2]._type, 'menuItem')
    assert.equal(draft.items[1].children[3]._key, 'sale')

    const patches = await sentPatches()
    assert.ok(
      patches.some((patch) => patch.insert?.before === `${WOMEN}.children[_key=="shoes"]`),
      `expected an insert before Shoes, got ${JSON.stringify(patches)}`,
    )
    assert.ok(patches.some((patch) => patch.insert?.after === `${SHOP}[_key=="men"]`))
  },

  "the item menu follows the tree's disableActions": {
    doc: ['optionsMenu', 'menu-options'],
    run: async (page, field) => {
      // disableActions: ['add', 'remove'] applies to nested rows too, and Duplicate adds an item
      await rowOf(field, 'Dresses').getByTestId('array-item-menu-button').first().click()
      const items = await page.getByRole('menuitem').allTextContents()
      assert.deepEqual(
        items.map((text) => text.trim()),
        ['Copy'],
      )
      // sortable: false: no drag handles, the tree's or the Studio's
      assert.equal(await field.getByRole('button', {name: 'Drag to reorder'}).count(), 0)
    },
  },

  'read-only rows open a View dialog and have no menu': {
    doc: ['readOnlyMenu', 'menu-readonly'],
    run: async (page, field) => {
      assert.equal(await field.getByTestId('array-item-menu-button').count(), 0)
      await field.getByText('Women', {exact: true}).first().click()
      const dialog = page.getByRole('dialog').last()
      await dialog.waitFor()
      await waitFor(
        async () => (await dialog.locator('input').first().inputValue()) === 'Women',
        'the dialog to show the Women item',
      )
      assert.ok(
        (await dialog.locator('input').first().isDisabled()) ||
          (await dialog.locator('input').first().getAttribute('readonly')) !== null,
      )
      assert.equal(await lake.doc('drafts.menu-readonly'), null)
    },
  },

  'copies a nested item and pastes it into the list': async (page, field) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await rowMenuAction(page, field, 'Dresses', 'Copy')
    // Copying writes nothing
    await page.waitForTimeout(500)
    assert.equal(await lake.doc('drafts.menu-main'), null)

    // Paste it with the field's own action: it's added at the end of the list
    await page
      .locator('[data-testid="field-actions-menu-items"]')
      .or(page.locator('[data-testid="field-items"] [data-testid*="field-actions"]'))
      .first()
      .click()
    await page.getByRole('menuitem', {name: 'Paste field'}).click()

    const draft = await waitFor(async () => {
      const doc = await lake.doc('drafts.menu-main')
      return doc?.items.length === 5 && doc
    }, 'the copied item pasted at the root')
    assert.equal(draft.items[4].title, 'Dresses')
    assert.notEqual(draft.items[4]._key, 'dresses')
    assert.deepEqual(keys(draft.items[1].children[0].children), ['dresses', 'shoes'])
  },
}

async function run() {
  const browser = await chromium.launch()
  let failed = 0

  for (const [name, entry] of Object.entries(tests)) {
    if (only && !name.includes(only)) continue
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
    await field.locator('li').first().waitFor({timeout: 120000})
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
