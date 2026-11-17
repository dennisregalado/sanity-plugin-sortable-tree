import {defineConfig} from '@sanity/pkg-utils'

export default defineConfig({
  dist: 'dist',
  tsconfig: 'tsconfig.dist.json',

  strictOptions: {
    // `@sanity/ui` and `@sanity/icons` are intentionally peer dependencies:
    // Sanity 6 already installs @sanity/ui 4 and @sanity/icons 5, and the plugin
    // must use the Studio's own copy (a nested copy would mean a second
    // ThemeProvider/Tooltip context tree). pkg-utils errors on this by default.
    noSanityUiPeerDependency: 'off',
    noSanityIconsPeerDependency: 'off',
  },
})
