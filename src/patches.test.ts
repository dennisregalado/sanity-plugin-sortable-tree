import {set, unset} from 'sanity'
import {describe, expect, it} from 'vitest'

import {
  getAppendPatches,
  getArrayAt,
  getMovePatches,
  getRemovePatches,
  prefixItemPatches,
} from './patches'
import type {Item} from './types'

const item = (key: string, children?: Item[]): Item => ({
  _key: key,
  _type: 'menuItem',
  title: key.toUpperCase(),
  ...(children ? {children} : {}),
})

const value: Item[] = [
  item('home'),
  item('shop', [item('women', [item('dresses')]), item('men')]),
  item('about', [item('team')]),
  item('contact'),
]

describe('getArrayAt', () => {
  it('returns the root array, nested arrays and [] for missing paths', () => {
    expect(getArrayAt(value, [])).toEqual(value)
    expect(getArrayAt(value, [{_key: 'shop'}, 'children']).map((i) => i._key)).toEqual([
      'women',
      'men',
    ])
    expect(getArrayAt(value, [{_key: 'nope'}, 'children'])).toEqual([])
    expect(getArrayAt(undefined, [])).toEqual([])
  })

  it('ignores malformed children', () => {
    const malformed: unknown = [{...item('x'), children: 'oops'}]
    expect(getArrayAt(malformed, [{_key: 'x'}, 'children'])).toEqual([])
  })
})

describe('getRemovePatches', () => {
  it('unsets only the item', () => {
    expect(getRemovePatches([{_key: 'shop'}, 'children', {_key: 'men'}])).toMatchObject([
      {type: 'unset', path: [{_key: 'shop'}, 'children', {_key: 'men'}]},
    ])
  })
})

describe('getAppendPatches', () => {
  it('appends to the root without setIfMissing (the Studio adds it)', () => {
    const newItem = {_key: 'new', _type: 'menuItem'}
    expect(getAppendPatches(newItem, [])).toMatchObject([
      {type: 'insert', position: 'after', path: [-1], items: [newItem]},
    ])
  })

  it('creates the children array when needed', () => {
    const newItem = {_key: 'new', _type: 'menuItem'}
    expect(getAppendPatches(newItem, [{_key: 'home'}, 'children'])).toMatchObject([
      {type: 'setIfMissing', path: [{_key: 'home'}, 'children'], value: []},
      {type: 'insert', position: 'after', path: [{_key: 'home'}, 'children', -1], items: [newItem]},
    ])
  })
})

describe('getMovePatches', () => {
  it('moves within the same array by key', () => {
    expect(
      getMovePatches(value, [{_key: 'contact'}], {parentPath: null, afterKey: 'home'}),
    ).toMatchObject([
      {type: 'unset', path: [{_key: 'contact'}]},
      {type: 'insert', position: 'after', path: [{_key: 'home'}], items: [value[3]]},
    ])
  })

  it('moves an item with its children into another parent', () => {
    const shop = value[1]
    expect(
      getMovePatches(value, [{_key: 'shop'}, 'children', {_key: 'women'}], {
        parentPath: [{_key: 'about'}],
        afterKey: 'team',
      }),
    ).toMatchObject([
      {type: 'unset', path: [{_key: 'shop'}, 'children', {_key: 'women'}]},
      {type: 'setIfMissing', path: [{_key: 'about'}, 'children'], value: []},
      {
        type: 'insert',
        position: 'after',
        path: [{_key: 'about'}, 'children', {_key: 'team'}],
        items: [shop?.children?.[0]],
      },
    ])
  })

  it('becomes the first child with beforeKey, or appends to an empty parent', () => {
    const toFirst = getMovePatches(value, [{_key: 'contact'}], {
      parentPath: [{_key: 'shop'}],
      beforeKey: 'women',
    })
    expect(toFirst.at(-1)).toMatchObject({
      type: 'insert',
      position: 'before',
      path: [{_key: 'shop'}, 'children', {_key: 'women'}],
    })

    const toEmpty = getMovePatches(value, [{_key: 'contact'}], {parentPath: [{_key: 'home'}]})
    expect(toEmpty.at(-1)).toMatchObject({
      type: 'insert',
      position: 'after',
      path: [{_key: 'home'}, 'children', -1],
    })
  })

  it('returns no patches when the item stays where it is', () => {
    expect(getMovePatches(value, [{_key: 'about'}], {parentPath: null, afterKey: 'shop'})).toEqual(
      [],
    )
    expect(getMovePatches(value, [{_key: 'home'}], {parentPath: null, beforeKey: 'shop'})).toEqual(
      [],
    )
  })

  it('gives the item a new key when its new siblings already use its key', () => {
    const clash: Item[] = [item('a', [item('dup')]), item('dup')]
    const patches = getMovePatches(clash, [{_key: 'dup'}], {parentPath: [{_key: 'a'}]})
    const inserted = patches.at(-1)

    expect(inserted?.type).toBe('insert')
    const movedItem = inserted?.type === 'insert' ? inserted.items[0] : undefined
    expect(movedItem).toMatchObject({_type: 'menuItem', title: 'DUP'})
    expect(movedItem).not.toMatchObject({_key: 'dup'})
  })

  it('keeps every other field of the moved item', () => {
    const withFields: Item[] = [
      {_key: 'a', _type: 't', id: 'products', index: 7, depth: 'deep', collapsed: true},
      item('b'),
    ]
    const patches = getMovePatches(withFields, [{_key: 'a'}], {parentPath: null, afterKey: 'b'})
    const inserted = patches.at(-1)

    expect(inserted?.type === 'insert' && inserted.items[0]).toEqual(withFields[0])
  })
})

describe('prefixItemPatches', () => {
  const itemPath = [{_key: 'products'}, 'children', {_key: 'ref-shoes'}]

  it('prefixes every patch with the item path', () => {
    expect(prefixItemPatches([set('page-journal', ['_ref']), unset(['_weak'])], itemPath)).toEqual([
      {...set('page-journal', ['_ref']), path: [...itemPath, '_ref']},
      {...unset(['_weak']), path: [...itemPath, '_weak']},
    ])
  })

  it('accepts a single patch and a patch event', () => {
    expect(prefixItemPatches(unset(), itemPath)).toEqual([{...unset(), path: itemPath}])
    expect(prefixItemPatches({patches: [unset(['_ref'])]}, itemPath)).toEqual([
      {...unset(['_ref']), path: [...itemPath, '_ref']},
    ])
  })
})
