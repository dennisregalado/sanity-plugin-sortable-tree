import type {ValidationContext} from 'sanity'
import {describe, expect, it} from 'vitest'

import type {Item} from './types'
import {validateTreeDepth} from './validate-tree-depth'

const item = (key: string, children?: Item[], field = 'children'): Item => ({
  _key: key,
  _type: 'menuItem',
  ...(children ? {[field]: children} : {}),
})

const context = (options?: Record<string, unknown>) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `type` is read
  ({type: {name: 'array', jsonType: 'array', of: [], options}}) as unknown as ValidationContext

const deep: Item[] = [
  item('l1', [item('l2', [item('l3', [item('l4', [item('l5')])])])]),
  item('other'),
]

describe('validateTreeDepth', () => {
  it('passes trees within the field’s maxDepth (3 by default)', async () => {
    expect(await validateTreeDepth()([item('a', [item('b', [item('c')])])], context())).toBe(true)
    expect(await validateTreeDepth()(undefined, context())).toBe(true)
  })

  it('flags only the outermost item that is too deep, at its path', async () => {
    expect(await validateTreeDepth()(deep, context({maxDepth: 3}))).toEqual([
      {
        message: 'Nested more than 3 levels deep',
        path: [
          {_key: 'l1'},
          'children',
          {_key: 'l2'},
          'children',
          {_key: 'l3'},
          'children',
          {_key: 'l4'},
        ],
      },
    ])
  })

  it('reads maxDepth and childrenField from the field, and lets options override them', async () => {
    const tree = [item('a', [item('b')], 'subpages')]
    expect(await validateTreeDepth()(tree, context({maxDepth: 1}))).toBe(true)
    expect(
      await validateTreeDepth()(tree, context({maxDepth: 1, childrenField: 'subpages'})),
    ).toEqual([
      {message: 'Nested more than 1 level deep', path: [{_key: 'a'}, 'subpages', {_key: 'b'}]},
    ])
    expect(
      await validateTreeDepth({maxDepth: 1, childrenField: 'subpages', message: (n) => `max ${n}`})(
        tree,
        context(),
      ),
    ).toEqual([{message: 'max 1', path: [{_key: 'a'}, 'subpages', {_key: 'b'}]}])
  })

  it('skips items without keys or with repeated keys', async () => {
    const tree = [{_key: 'a', children: [{_type: 'menuItem'}, item('b'), item('b')]}]
    expect(await validateTreeDepth({maxDepth: 1})(tree, context())).toEqual([
      {message: 'Nested more than 1 level deep', path: [{_key: 'a'}, 'children', {_key: 'b'}]},
    ])
  })
})
