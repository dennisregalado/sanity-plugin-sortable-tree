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

/** Drags the row showing `text` by its handle, from its center by `dx`/`dy` pixels */
async function dragRow(page, field, text, dx, dy) {
  const handle = rowOf(field, text).locator('button').first()
  const from = await handle.boundingBox()
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 5, y + 5, {steps: 3})
  await page.mouse.move(x + dx, y + dy, {steps: 20})
  await page.waitForTimeout(400)
  await page.mouse.up()
}

/** Picks the document titled `title` in the open reference search */
async function pickInSearch(page, query, title) {
  await page.keyboard.type(query, {delay: 50})
  const option = page.locator('[data-ui="Popover"]').getByRole('button', {name: new RegExp(title)})
  await option.first().waitFor()
  await option.first().click()
}

/** Adds a reference of the given type from the last "Add item" menu and waits for its search */
async function addReference(page, field, typeTitle) {
  await field.getByRole('button', {name: 'Add item'}).last().click()
  await page.getByRole('menuitem', {name: typeTitle}).click()
  await waitFor(
    () =>
      page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') === 'Search for a reference',
      ),
    'the reference search to be focused',
  )
}

const PAGES = ['pageMenu', 'menu-pages']
const LINKS = ['linkMenu', 'menu-links']

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

      // Let the rows that just mounted settle before hovering
      await page.waitForTimeout(800)
      await last.hover()
      await last
        .locator('xpath=ancestor::li[1]')
        .getByRole('button', {name: 'Remove'})
        .first()
        .click()

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-big')
        return doc && doc.items.length === 99 && doc
      }, 'Group 100 removed')
      assert.equal(draft.items.at(-1)._key, 'g98')
      const patches = await sentPatches()
      assert.ok(patches.some((patch) => patch.unset?.includes('items[_key=="g99"]')))
    },
  },

  'reorders a long tree with the pointer, twice in a row': {
    doc: ['menu', 'menu-big'],
    run: async (page, field) => {
      // Drags a root row up to just above another root row. Rows whose index shifted during the
      // first drag aren't re-rendered for it, so the second drag checks they still work.
      const dragAbove = async (title, targetTitle) => {
        const handle = rowOf(field, title).locator('button').first()
        const from = await handle.boundingBox()
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await page.mouse.move(from.x + from.width / 2, from.y - 10, {steps: 5})
        const to = await rowOf(field, targetTitle).locator('button').first().boundingBox()
        await page.mouse.move(from.x + from.width / 2, to.y + 4, {steps: 20})
        await page.waitForTimeout(300)
        await page.mouse.up()
        await page.waitForTimeout(600)
      }

      await dragAbove('Group 3', 'Group 1')
      await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-big')
        return doc && keys(doc.items)[0] === 'g2'
      }, 'Group 3 moved to the top')

      await dragAbove('Group 2', 'Group 3')
      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-big')
        return doc && keys(doc.items)[0] === 'g1' && doc
      }, 'Group 2 moved to the top')

      assert.deepEqual(keys(draft.items).slice(0, 5), ['g1', 'g2', 'g0', 'g3', 'g4'])
      assert.equal(draft.items.length, 100)
      assert.deepEqual(keys(draft.items[0].children), ['g1a', 'g1b'])
    },
  },

  'adds a reference and picks a page in the row': {
    doc: PAGES,
    run: async (page, field) => {
      await field.getByRole('button', {name: 'Add item'}).last().click()
      await page.getByRole('menuitem', {name: 'Page'}).click()

      // The new row shows the reference search, focused
      await waitFor(
        () =>
          page.evaluate(
            () => document.activeElement?.getAttribute('aria-label') === 'Search for a reference',
          ),
        'the reference search to be focused',
      )
      // The row only picks existing documents: no "Create" button
      assert.equal(await field.getByRole('button', {name: 'Create'}).count(), 0)
      await pickInSearch(page, 'Jour', 'Journal')

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-pages')
        return doc?.items.length === 6 && doc.items[5]._ref && doc
      }, 'a sixth root item referencing a page')

      assert.equal(draft.items[5]._type, 'reference')
      assert.equal(draft.items[5]._ref, 'page-journal')
      assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog opens')
      const patches = await sentPatches()
      assert.ok(patches.some((patch) => patch.insert?.after === 'items[-1]'))
      assert.ok(!patches.some((patch) => patch.set && 'items' in patch.set))
    },
  },

  'removes a just-added reference left without picking': {
    doc: PAGES,
    run: async (page, field) => {
      await field.getByRole('button', {name: 'Add item'}).last().click()
      await page.getByRole('menuitem', {name: 'Page'}).click()
      await waitFor(
        () =>
          page.evaluate(
            () => document.activeElement?.getAttribute('aria-label') === 'Search for a reference',
          ),
        'the reference search to be focused',
      )
      await page.waitForTimeout(500)
      await page.keyboard.press('Escape')

      await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-pages')
        return doc?.items.length === 5
      }, 'the empty reference removed again')
      // The fixture's own empty reference stays
      assert.equal(await field.getByRole('textbox', {name: 'Search for a reference'}).count(), 1)
    },
  },

  'searches every type a reference can point to, and picks either': {
    doc: LINKS,
    run: async (page, field) => {
      await addReference(page, field, 'Page or product')
      // Before typing: pages and products, under one heading
      const popover = page.locator('[data-ui="Popover"]')
      await popover.getByText('Documents', {exact: true}).waitFor()
      await popover.getByRole('button', {name: /Tote bag/}).waitFor()
      await popover.getByRole('button', {name: /Journal/}).waitFor()
      await pickInSearch(page, 'Tote', 'Tote bag')

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-links')
        return doc?.items.length === 4 && doc.items[3]._ref && doc
      }, 'a reference to the tote bag product')
      assert.deepEqual(
        {_type: draft.items[3]._type, _ref: draft.items[3]._ref, _weak: draft.items[3]._weak},
        {_type: 'link', _ref: 'prod-tote', _weak: undefined},
      )
    },
  },

  'makes a reference to a draft-only document weak until it is published': {
    doc: LINKS,
    run: async (page, field) => {
      await addReference(page, field, 'Page or product')
      await pickInSearch(page, 'Draft', 'Draft hat')

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-links')
        return doc?.items[3]?._ref && doc
      }, 'a reference to the draft hat')
      assert.deepEqual(draft.items[3]._ref, 'prod-hat')
      assert.equal(draft.items[3]._weak, true)
      assert.deepEqual(draft.items[3]._strengthenOnPublish, {type: 'product'})
    },
  },

  'keeps weak reference types weak': {
    doc: LINKS,
    run: async (page, field) => {
      await addReference(page, field, 'Page (weak)')
      await pickInSearch(page, 'Jour', 'Journal')

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-links')
        return doc?.items[3]?._ref && doc
      }, 'a weak reference to Journal')
      assert.equal(draft.items[3]._type, 'weakPage')
      assert.equal(draft.items[3]._ref, 'page-journal')
      assert.equal(draft.items[3]._weak, true)
      assert.equal(draft.items[3]._strengthenOnPublish, undefined)
    },
  },

  "applies the reference type's search filter": {
    doc: LINKS,
    run: async (page, field) => {
      await addReference(page, field, 'Product page')
      const popover = page.locator('[data-ui="Popover"]')
      // `slug match "/products*"`: Products, Shoes and Bags, not Home or Journal
      await popover.getByRole('button', {name: /Shoes/}).waitFor()
      const titles = await popover.getByRole('button').allInnerTexts()
      assert.ok(!titles.some((text) => /Home|Journal|Contact/.test(text)), titles.join(', '))
    },
  },

  'replaces a nested reference in the row, with patches at its path': {
    doc: PAGES,
    run: async (page, field) => {
      const shoes = rowOf(field, 'Shoes')
      // Clicking the row opens the page in a pane to the right, and the row shows it's open
      await shoes.getByText('Shoes', {exact: true}).first().click()
      await waitFor(() => page.url().includes('page-shoes'), 'the Shoes page to open in a pane')
      await waitFor(
        async () =>
          (await shoes.locator('a [data-selected]').count()) > 0 ||
          (await shoes.locator('a [data-ui="Button"][data-selected=""]').count()) > 0,
        'the row to be selected while its pane is open',
      )
      // Close the pane again: at this width it squeezes the document's own pane
      await page.goBack()
      await waitFor(() => !page.url().includes('page-shoes'), 'the Shoes pane to close')
      await page.mouse.move(1, 1)

      // Escape leaves the search and keeps the reference
      await shoes.getByText('Shoes', {exact: true}).first().hover()
      await shoes.getByRole('button', {name: 'Replace reference'}).click()
      await page.keyboard.press('Escape')
      await shoes.getByText('Shoes', {exact: true}).first().waitFor()

      await shoes.getByText('Shoes', {exact: true}).first().hover()
      await shoes.getByRole('button', {name: 'Replace reference'}).click()
      await waitFor(
        () =>
          page.evaluate(
            () => document.activeElement?.getAttribute('aria-label') === 'Search for a reference',
          ),
        'the reference search to be focused',
      )
      await pickInSearch(page, 'Jour', 'Journal')

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-pages')
        return doc?.items[1].children[0]._ref === 'page-journal' && doc
      }, 'Shoes replaced with Journal')

      assert.deepEqual(keys(draft.items[1].children), ['ref-shoes', 'ref-bags', 'more'])
      assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog opens')
      const paths = (await sentPatches()).flatMap((patch) =>
        Object.values(patch).flatMap((v) => (Array.isArray(v) ? v : Object.keys(v ?? {}))),
      )
      assert.ok(
        paths.every((path) => !path.startsWith('items[_key=="ref-shoes"]')),
        `patches must target the nested item: ${JSON.stringify(paths)}`,
      )
    },
  },

  "drags a reference into a menu item's children, keeping its fields": {
    doc: PAGES,
    run: async (page, field) => {
      // "About us" (under "Company") to just below "Bags" (under "Products")
      const bags = await rowOf(field, 'Bags').boundingBox()
      const about = await rowOf(field, 'About us').locator('button').first().boundingBox()
      await dragRow(page, field, 'About us', 0, bags.y + bags.height - 6 - about.y)

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-pages')
        return doc && keys(doc.items[1].children).includes('ref-about') && doc
      }, 'About us moved under Products')

      const moved = draft.items[1].children.find((child) => child._key === 'ref-about')
      assert.deepEqual(moved, {
        _key: 'ref-about',
        _type: 'reference',
        _ref: 'page-about',
        _weak: true,
        _strengthenOnPublish: {type: 'page'},
      })
      assert.deepEqual(keys(draft.items[2].children), ['ref-missing'])
      const patches = await sentPatches()
      assert.ok(
        patches.some((p) =>
          p.unset?.includes('items[_key=="company"].children[_key=="ref-about"]'),
        ),
      )
    },
  },

  "won't drop an item into a reference": {
    doc: PAGES,
    run: async (page, field) => {
      // "Bags" follows the reference "Shoes": pulling it right would nest it there
      await dragRow(page, field, 'Bags', 120, 0)
      await page.waitForTimeout(1500)

      assert.equal(await lake.doc('drafts.menu-pages'), null, 'nothing is written')
      assert.deepEqual(await sentPatches(), [])
    },
  },

  'removes a nested reference with a single unset': {
    doc: PAGES,
    run: async (page, field) => {
      const row = rowOf(field, 'Bags')
      await row.getByText('Bags', {exact: true}).first().hover()
      await row.getByRole('button', {name: 'Remove'}).click()

      const draft = await waitFor(async () => {
        const doc = await lake.doc('drafts.menu-pages')
        return doc && !keys(doc.items[1].children).includes('ref-bags') && doc
      }, 'Bags removed')

      assert.deepEqual(keys(draft.items[1].children), ['ref-shoes', 'more'])
      // The Studio adds an unset of a guard field to every edit action: ignore it
      const unsets = (await sentPatches())
        .flatMap((patch) => patch.unset ?? [])
        .filter((path) => path !== '_empty_action_guard_pseudo_field_')
      assert.deepEqual(unsets, ['items[_key=="products"].children[_key=="ref-bags"]'])
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
