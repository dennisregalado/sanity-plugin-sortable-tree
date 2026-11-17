/**
 * Captures frames of a pointer drag at fixed moments, in the Studio's own array input and in the
 * tree, for comparing how dragging looks (see docs/native-drag/).
 *
 * Needs the fake lake and the test Studio (`npm run dev`).
 *
 * Usage: node dev/e2e/drag-frames.mjs <outDir> [studioUrl] [subject...]
 *   Subjects: native, native-validation, tree, tree-validation (default: all)
 *   Writes <outDir>/<subject>.<frame>.<light|dark>.png
 */
import {mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const {chromium} = require('playwright')

const [outDir = 'drag-frames', studioUrl = 'http://localhost:3333', ...only] = process.argv.slice(2)
const LAKE = `https://localhost:${process.env.FAKE_LAKE_PORT || 3334}`
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const docUrl = (type, id) => `${studioUrl}/structure/${type};${id}`

/** The drag handle of the "Contact" row */
const nativeHandle = (field) =>
  field
    .getByText('Contact', {exact: true})
    .first()
    .locator('xpath=ancestor::*[.//*[@data-ui="DragHandleButton"]][1]')
    .locator('[data-ui="DragHandleButton"]')
    .first()
const treeHandle = (field) =>
  field
    .getByText('Contact', {exact: true})
    .first()
    .locator('xpath=ancestor::li[1]')
    .locator('button')
    .first()

const subjects = {
  'native': {url: docUrl('nativeMenu', 'menu-native'), handle: nativeHandle},
  'native-validation': {url: docUrl('nativeMenu', 'menu-native-validation'), handle: nativeHandle},
  'tree': {url: docUrl('menu', 'menu-main'), handle: treeHandle},
  'tree-validation': {url: docUrl('menu', 'menu-validation'), handle: treeHandle},
}

/**
 * The moments captured, as pointer offsets from the handle (in CSS pixels) and how long to wait
 * before the capture. Same offsets in both inputs, so the frames line up.
 */
const frames = [
  {name: '1-lifted', to: {x: 4, y: -8}, steps: 4, wait: 400},
  {name: '2-up-one-row', to: {x: 4, y: -52}, steps: 8, wait: 400},
  {name: '3-sliding', to: {x: 4, y: -104}, steps: 3, wait: 70},
  {name: '4-up-two-rows', wait: 400},
  {name: '5-dropped', drop: true, wait: 700},
]

async function run() {
  mkdirSync(outDir, {recursive: true})
  const browser = await chromium.launch()
  const names = only.length ? only : Object.keys(subjects)

  for (const scheme of ['light', 'dark']) {
    for (const name of names) {
      const subject = subjects[name]
      const reset = await fetch(`${LAKE}/__fake/reset`, {method: 'POST'})
      if (!reset.ok) throw new Error(`Could not reset the fake lake: ${reset.status}`)
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: {width: 1100, height: 1400},
        deviceScaleFactor: 2,
        colorScheme: scheme,
      })
      const page = await context.newPage()
      await page.goto(subject.url)
      const field = page.locator('[data-testid="field-items"]')
      await field.getByText('Contact', {exact: true}).first().waitFor({timeout: 120000})
      await page.waitForTimeout(2000)
      await page.addStyleTag({content: '*{caret-color:transparent!important}'})
      await page.mouse.move(0, 0)

      const box = await subject.handle(field).boundingBox()
      const start = {x: box.x + box.width / 2, y: box.y + box.height / 2}
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()

      for (const frame of frames) {
        if (frame.to) {
          await page.mouse.move(start.x + frame.to.x, start.y + frame.to.y, {steps: frame.steps})
        }
        if (frame.drop) await page.mouse.up()
        await page.waitForTimeout(frame.wait)
        const file = `${outDir}/${name}.${frame.name}.${scheme}.png`
        await field.screenshot({path: file, animations: 'allow'})
        console.log(file)
      }
      await context.close()
    }
  }
  await browser.close()
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
