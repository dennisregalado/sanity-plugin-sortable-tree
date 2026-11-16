# sanity-plugin-sortable-tree

Sortable nested tree input for Sanity array fields.

## Installation

```sh
npm install sanity-plugin-sortable-tree
```

### Requirements

- **Sanity Studio v6** (`sanity@^6`).
- `@sanity/ui@^4` and `@sanity/icons@^5` are peer dependencies. `sanity` already installs both, so you don't need to add them yourself; the plugin uses the Studio's own copies.
- **Sanity Studio v5 is not supported** by this release, because it ships `@sanity/ui` 3 and `@sanity/icons` 3. If you're on Sanity 5, stay on `sanity-plugin-sortable-tree@1.x`:

  ```sh
  npm install sanity-plugin-sortable-tree@^1
  ```

## Usage

Add it as a plugin in `sanity.config.ts` (or .js):

```ts
import {defineConfig} from 'sanity'
import {sortableTree} from 'sanity-plugin-sortable-tree'

export default defineConfig({
  //...
  plugins: [sortableTree()],
})
```

Enable the tree input on an array field with `options.tree`:

```ts
defineField({
  name: 'items',
  type: 'array',
  options: {
    tree: true,
    maxDepth: 3, // optional, default 3
  },
  of: [
    defineArrayMember({
      type: 'object',
      name: 'menuItem',
      fields: [
        defineField({name: 'link', type: 'link'}),
        // nested children live on `children`
      ],
    }),
  ],
})
```

## License

[MIT](LICENSE) © Dennis Regalado

## Develop & test

This plugin uses [@sanity/plugin-kit](https://github.com/sanity-io/plugin-kit)
with default configuration for build & watch scripts.

See [Testing a plugin in Sanity Studio](https://github.com/sanity-io/plugin-kit#testing-a-plugin-in-sanity-studio)
on how to run this plugin with hotreload in the studio.

## Release

Releases are published to npm from GitHub Actions ([`publish.yml`](.github/workflows/publish.yml)); don't run `npm publish` locally.

1. In your PR, bump `"version"` in `package.json` (e.g. `npm version minor --no-git-tag-version`).
2. Merge it to `main`. The publish workflow runs the typecheck and build, publishes that version to npm with provenance, and creates the `v<version>` tag and GitHub release.

Merges that don't change the version publish nothing. Versions with a pre-release suffix (e.g. `2.1.0-beta.0`) are published under the `next` dist-tag.
