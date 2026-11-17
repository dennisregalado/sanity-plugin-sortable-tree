import {defineArrayMember, defineField, defineType} from 'sanity'

const menuItem = defineType({
  name: 'menuItem',
  title: 'Menu item',
  type: 'object',
  fields: [
    defineField({name: 'title', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'url', type: 'string'}),
    defineField({name: 'children', type: 'array', of: [defineArrayMember({type: 'menuItem'})]}),
  ],
  preview: {select: {title: 'title', subtitle: 'url'}},
})

const menuDivider = defineType({
  name: 'menuDivider',
  title: 'Divider',
  type: 'object',
  fields: [defineField({name: 'label', type: 'string'})],
})

/** Items whose field names collide with the tree's internal bookkeeping */
const fieldsItem = defineType({
  name: 'fieldsItem',
  title: 'Fields item',
  type: 'object',
  fields: [
    defineField({name: 'title', type: 'string'}),
    defineField({name: 'id', type: 'string'}),
    defineField({name: 'index', type: 'number'}),
    defineField({name: 'depth', type: 'string'}),
    defineField({name: 'parentId', type: 'string'}),
    defineField({name: 'collapsed', type: 'boolean'}),
    defineField({name: 'children', type: 'array', of: [defineArrayMember({type: 'fieldsItem'})]}),
  ],
})

/** A named array type: the tree should apply to it too */
const menuTree = defineType({
  name: 'menuTree',
  title: 'Menu tree',
  type: 'array',
  of: [defineArrayMember({type: 'menuItem'})],
  options: {tree: true},
})

const title = defineField({name: 'title', type: 'string'})

export const schemaTypes = [
  menuItem,
  menuDivider,
  fieldsItem,
  menuTree,
  defineType({
    name: 'menu',
    title: 'Menu',
    type: 'document',
    fields: [
      title,
      defineField({
        name: 'items',
        type: 'array',
        of: [defineArrayMember({type: 'menuItem'})],
        options: {tree: true, maxDepth: 3},
      }),
    ],
  }),
  defineType({
    name: 'readOnlyMenu',
    title: 'Read-only menu',
    type: 'document',
    fields: [
      title,
      defineField({
        name: 'items',
        type: 'array',
        readOnly: true,
        of: [defineArrayMember({type: 'menuItem'})],
        options: {tree: true},
      }),
    ],
  }),
  defineType({
    name: 'namedMenu',
    title: 'Named array menu',
    type: 'document',
    fields: [title, defineField({name: 'items', type: 'menuTree'})],
  }),
  defineType({
    name: 'mixedMenu',
    title: 'Mixed menu',
    type: 'document',
    fields: [
      title,
      defineField({
        name: 'items',
        type: 'array',
        of: [defineArrayMember({type: 'menuItem'}), defineArrayMember({type: 'menuDivider'})],
        options: {tree: true},
      }),
    ],
  }),
  defineType({
    name: 'optionsMenu',
    title: 'Options menu',
    type: 'document',
    fields: [
      title,
      defineField({
        name: 'items',
        type: 'array',
        of: [defineArrayMember({type: 'menuItem'})],
        options: {tree: true, sortable: false, disableActions: ['add', 'remove']},
      }),
    ],
  }),
  defineType({
    // The Studio's own array input (no `options.tree`): the reference for how dragging looks
    name: 'nativeMenu',
    title: 'Native array menu',
    type: 'document',
    fields: [
      title,
      defineField({name: 'items', type: 'array', of: [defineArrayMember({type: 'menuItem'})]}),
    ],
  }),
  defineType({
    name: 'fieldsMenu',
    title: 'Fields menu',
    type: 'document',
    fields: [
      title,
      defineField({
        name: 'items',
        type: 'array',
        of: [defineArrayMember({type: 'fieldsItem'})],
        options: {tree: true},
      }),
    ],
  }),
]
