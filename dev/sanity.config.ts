import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'

import {sortableTree} from '../src'
import {schemaTypes} from './schema'

// Override to run several Studios against separate fake lakes
const FAKE_LAKE_PORT = Number(process.env.SANITY_STUDIO_FAKE_LAKE_PORT || 3334)

/**
 * Test Studio for developing the plugin. It talks to the in-memory fake Content Lake in
 * `dev/fake-lake` (via `apiHost`), so it needs no Sanity project, login or network.
 */
export default defineConfig({
  name: 'default',
  title: 'Sortable tree test',
  projectId: 'fakelake',
  dataset: 'test',
  apiHost: `https://localhost:${FAKE_LAKE_PORT}`,
  plugins: [structureTool(), sortableTree()],
  schema: {types: schemaTypes},
})
