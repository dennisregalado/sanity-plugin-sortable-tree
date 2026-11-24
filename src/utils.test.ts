import {describe, expect, it} from 'vitest'

import type {Item} from './types'
import {flattenTree, getDescendants, getFocusItemIds, getProjection, walkTree} from './utils'

const item = (key: string, children?: Item[]): Item => ({
  _key: key,
  _type: 'menuItem',
  ...(children ? {children} : {}),
})

const value: Item[] = [
  item('home'),
  item('shop', [item('women', [item('dresses')]), item('men')]),
  item('contact'),
]

describe('walkTree', () => {
  it('visits items depth-first with path-based ids', () => {
    const ids: string[] = []
    walkTree(value, (_item, id) => {
      ids.push(id)
    })
    expect(ids).toEqual(['home', 'shop', 'shop/women', 'shop/women/dresses', 'shop/men', 'contact'])
  })

  it('skips malformed items and children without throwing', () => {
    const malformed = [
      null,
      'string',
      {_type: 'menuItem'},
      {_key: '', _type: 'menuItem'},
      {...item('a'), children: 'oops'},
      {...item('b'), children: {not: 'an array'}},
      item('c', [item('dup'), item('dup')]),
    ]
    const ids: string[] = []
    walkTree(malformed, (_item, id) => {
      ids.push(id)
    })
    expect(ids).toEqual(['a', 'b', 'c', 'c/dup'])
  })

  it('accepts non-array input', () => {
    expect(() => walkTree(undefined, () => {})).not.toThrow()
    expect(() => walkTree({}, () => {})).not.toThrow()
  })
})

describe('flattenTree', () => {
  it('keeps user fields named like tree bookkeeping out of the original values', () => {
    const items: Item[] = [{_key: 'a', _type: 't', id: 'products', index: 7}]
    const [flat] = flattenTree(items)

    expect(flat).toMatchObject({id: 'a', index: 0, depth: 0, parentId: null})
    // the source value is untouched
    expect(items[0]).toEqual({_key: 'a', _type: 't', id: 'products', index: 7})
  })

  it('leaves out children of collapsed items unless asked to keep them', () => {
    const collapsed = new Set(['shop'])
    expect(flattenTree(value, collapsed).map((i) => i.id)).toEqual(['home', 'shop', 'contact'])
    expect(flattenTree(value, collapsed, false).map((i) => i.id)).toEqual([
      'home',
      'shop',
      'shop/women',
      'shop/women/dresses',
      'shop/men',
      'contact',
    ])
  })
})

describe('getDescendants', () => {
  it('returns every nested id', () => {
    expect([...getDescendants(flattenTree(value), 'shop')]).toEqual([
      'shop/women',
      'shop/women/dresses',
      'shop/men',
    ])
  })
})

describe('getProjection', () => {
  const flat = flattenTree(value)

  it('nests at most one level deeper than the item is now, within maxDepth', () => {
    // "contact" is at the root, right after "shop/men"
    expect(getProjection(flat, 'contact', 1)).toMatchObject({depth: 1, parentId: 'shop'})
    expect(getProjection(flat, 'contact', 5)).toMatchObject({depth: 1, parentId: 'shop'})
    // maxDepth counts levels: 1 means root only
    expect(getProjection(flat, 'contact', 5, 1)).toMatchObject({depth: 0, parentId: null})
  })

  it('nests deeper when the item already is', () => {
    // "shop/men" (depth 1) follows "shop/women/dresses" (depth 2)
    expect(getProjection(flat, 'shop/men', 2)).toMatchObject({depth: 2, parentId: 'shop/women'})
  })

  it('keeps the first item at the root', () => {
    expect(getProjection(flat, 'home', 3)).toMatchObject({depth: 0, parentId: null})
  })

  it("never nests under an item that can't have children (a reference)", () => {
    const refs: Item[] = [
      {_key: 'ref', _type: 'reference', _ref: 'page-home'},
      item('about'),
      item('shop', [{_key: 'ref2', _type: 'reference', _ref: 'page-shoes'}]),
      item('contact'),
    ]
    const flatRefs = flattenTree(refs)
    const isLeaf = (entry: {_type?: string}) => entry._type === 'reference'
    const canHaveChildren = (entry: {_type?: string}) => !isLeaf(entry)

    // "about" right after the root reference: pulling it right keeps it a sibling
    expect(getProjection(flatRefs, 'about', 1, 3, canHaveChildren)).toMatchObject({
      depth: 0,
      parentId: null,
    })
    // "contact" right after "shop/ref2": it can join "shop", but not go under the reference
    expect(getProjection(flatRefs, 'contact', 2, 3, canHaveChildren)).toMatchObject({
      depth: 1,
      parentId: 'shop',
    })
    // Without the check, it would nest under the reference
    expect(getProjection(flatRefs, 'about', 1)).toMatchObject({depth: 1, parentId: 'ref'})
  })
})

describe('childrenField', () => {
  const subpages: Item[] = [
    {_key: 'a', _type: 'page', subpages: [{_key: 'b', _type: 'page', children: [{_key: 'x'}]}]},
  ]

  it('walks and flattens the nested items in that field', () => {
    const ids: string[] = []
    walkTree(subpages, (_item, id) => void ids.push(id), 'subpages')
    expect(ids).toEqual(['a', 'a/b'])
    expect(flattenTree(subpages, new Set(), true, 'subpages').map((i) => i.id)).toEqual([
      'a',
      'a/b',
    ])
  })
})

describe('getFocusItemIds', () => {
  it('returns the items on the focus path, through the children field', () => {
    expect(
      getFocusItemIds([{_key: 'shop'}, 'children', {_key: 'women'}, 'title'], 'children'),
    ).toEqual(['shop', 'shop/women'])
    expect(getFocusItemIds([{_key: 'a'}, 'subpages', {_key: 'b'}], 'subpages')).toEqual([
      'a',
      'a/b',
    ])
    expect(getFocusItemIds([{_key: 'a'}, 'subpages', {_key: 'b'}], 'children')).toEqual(['a'])
    expect(getFocusItemIds(undefined)).toEqual([])
  })
})
