import {describe, expect, it} from 'vitest'

import type {Item} from './types'
import {
  getInitialCollapsedKeys,
  getStorageKey,
  getTogglesToStore,
  readStoredToggles,
} from './use-collapsed-items'

const items: Item[] = [
  {_key: 'shop', collapsed: true, children: [{_key: 'women', children: [{_key: 'dresses'}]}]},
  {_key: 'about', children: [{_key: 'team'}]},
]

describe('getStorageKey', () => {
  it('needs every part', () => {
    expect(getStorageKey(['p', 'd', 'u', 'menu', 'items'])).toBe(
      'sanity-plugin-sortable-tree:collapsed:p:d:u:menu:items',
    )
    expect(getStorageKey(['p', 'd', undefined, 'menu', 'items'])).toBeUndefined()
  })
})

describe('getInitialCollapsedKeys', () => {
  it('starts from the stored `collapsed: true`', () => {
    expect([...getInitialCollapsedKeys(items, 'children', undefined)]).toEqual(['shop'])
  })

  it('lets the user’s remembered toggles win', () => {
    const keys = getInitialCollapsedKeys(items, 'children', {
      collapsed: ['about', 'shop/women'],
      expanded: ['shop'],
    })
    expect([...keys].sort()).toEqual(['about', 'shop/women'])
  })
})

describe('getTogglesToStore', () => {
  it('stores the toggled items still in the tree, by their state', () => {
    expect(
      getTogglesToStore(
        new Set(['shop', 'about', 'gone']),
        new Set(['about', 'gone']),
        new Set(['shop', 'about']),
      ),
    ).toEqual({collapsed: ['about'], expanded: ['shop']})
  })
})

describe('readStoredToggles', () => {
  it('reads nothing without a key or without storage', () => {
    expect(readStoredToggles(undefined)).toBeUndefined()
    // No `window` in the test environment: storage is unavailable, not an error
    expect(readStoredToggles('key')).toBeUndefined()
  })
})
