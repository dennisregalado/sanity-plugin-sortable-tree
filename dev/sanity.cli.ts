import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {projectId: 'fakelake', dataset: 'test'},
  server: {port: 3333},
  // Keep the test Studio offline and deterministic
  deployment: {autoUpdates: false},
})
