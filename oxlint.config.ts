import sanityPluginKitOxlint from '@sanity/plugin-kit/oxlint'
import {defineConfig} from 'oxlint'

export default defineConfig({
  extends: [sanityPluginKitOxlint],
  overrides: [
    {
      // The test Studio's Node scripts run browser steps one after another and report on stdout
      files: ['dev/e2e/**', 'dev/fake-lake/**'],
      rules: {'no-await-in-loop': 'off', 'no-console': 'off'},
    },
  ],
})
