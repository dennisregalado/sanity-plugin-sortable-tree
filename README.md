# sanity-plugin-sortable-tree

Sortable nested tree input for Sanity array fields.

## Installation

```sh
npm install sanity-plugin-sortable-tree
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
