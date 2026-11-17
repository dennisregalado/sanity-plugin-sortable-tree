/**
 * Starts the test Studio: the fake Content Lake and `sanity dev`, together.
 *
 * Usage: npm run dev   (Studio on http://localhost:3333, fake lake on https://localhost:3334)
 *
 * Environment: STUDIO_PORT (3333), FAKE_LAKE_PORT (3334).
 */
import {spawn} from 'node:child_process'
import {existsSync, symlinkSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const devDir = fileURLToPath(new URL('.', import.meta.url))
const studioPort = process.env.STUDIO_PORT || '3333'
const lakePort = process.env.FAKE_LAKE_PORT || '3334'

// The Sanity CLI resolves the Studio's dependencies from dev/node_modules: link the root one
const link = new URL('./node_modules', import.meta.url)
if (!existsSync(link)) {
  symlinkSync('../node_modules', link, process.platform === 'win32' ? 'junction' : 'dir')
}

const children = [
  spawn(process.execPath, ['fake-lake/server.mjs', lakePort], {cwd: devDir, stdio: 'inherit'}),
  spawn('npx', ['sanity', 'dev', '--port', studioPort], {
    cwd: devDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {...process.env, DO_NOT_TRACK: '1', SANITY_STUDIO_FAKE_LAKE_PORT: lakePort},
  }),
]

function stop(code = 0) {
  for (const child of children) child.kill()
  process.exit(code)
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
for (const child of children) {
  child.on('exit', (code) => stop(code ?? 1))
}
