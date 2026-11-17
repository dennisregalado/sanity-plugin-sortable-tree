import {describe, expect, it} from 'vitest'

import {
  getCollapsedLists,
  getCollapseLimit,
  getParentId,
  getWorkspaceCollapseLimit,
  ROOT_LIST,
} from './collapse-lists'
import type {Item} from './types'

const item = (key: string, children?: Item[]): Item => ({
  _key: key,
  _type: 'menuItem',
  ...(children ? {children} : {}),
})
const range = (prefix: string, count: number, children?: Item[]) =>
  Array.from({length: count}, (_, index) =>
    item(`${prefix}${index}`, index === 0 ? children : undefined),
  )

describe('getCollapseLimit', () => {
  it("uses the field's collapseItemsAfter, then the workspace's limit", () => {
    expect(getCollapseLimit({options: {collapseItemsAfter: 6}}, 4)).toBe(6)
    expect(getCollapseLimit({options: {collapseItemsAfter: false}}, 4)).toBe(Infinity)
    expect(getCollapseLimit({options: {collapseItemsAfter: 2.5}}, 4)).toBe(4)
    expect(getCollapseLimit({options: {}}, 4)).toBe(4)
    expect(getCollapseLimit(undefined, 7)).toBe(7)
  })

  it("reads the workspace's form.arrays.collapseItems like the Studio", () => {
    expect(getWorkspaceCollapseLimit(undefined)).toBe(4)
    expect(getWorkspaceCollapseLimit({limit: 10})).toBe(10)
    expect(getWorkspaceCollapseLimit({enabled: false, limit: 10})).toBe(Infinity)
  })
})

describe('getCollapsedLists', () => {
  // 6 root items; the first has 5 children, the first of which has 3 children
  const items = [item('r0', range('c', 5, range('g', 3))), ...range('r', 6).slice(1)]
  const limit = () => 4

  it('hides the items past the limit in every list, with their children', () => {
    const {hidden, collapsible} = getCollapsedLists(items, limit, new Set())

    expect([...collapsible]).toEqual([
      [ROOT_LIST, 6],
      ['r0', 5],
    ])
    expect([...hidden].sort()).toEqual(['r0/c4', 'r4', 'r5'])
  })

  it('shows every item of an expanded list', () => {
    const {hidden} = getCollapsedLists(items, limit, new Set([ROOT_LIST]))
    expect([...hidden]).toEqual(['r0/c4'])
  })

  it('takes each list its own limit', () => {
    const {hidden} = getCollapsedLists(
      items,
      (parentId) => (parentId === null ? Infinity : 2),
      new Set(),
    )
    expect([...hidden].sort()).toEqual(['r0/c0/g2', 'r0/c2', 'r0/c3', 'r0/c4'])
  })
})

describe('getParentId', () => {
  it('returns the parent of a tree id', () => {
    expect(getParentId('a/b/c')).toBe('a/b')
    expect(getParentId('a')).toBeNull()
  })
})
