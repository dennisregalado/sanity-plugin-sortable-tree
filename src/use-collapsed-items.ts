import {useCallback, useEffect, useRef, useState} from 'react'
import type {Path} from 'sanity'

import type {Item} from './types'
import {getFocusItemIds, walkTree} from './utils'

/** Items the user expanded or collapsed themselves, remembered in the browser per document */
export interface StoredToggles {
  collapsed: string[]
  expanded: string[]
}

const STORAGE_PREFIX = 'sanity-plugin-sortable-tree:collapsed:'

/** The storage key for one tree: the dataset, the user, the document (any version) and the field */
export function getStorageKey(parts: (string | undefined)[]): string | undefined {
  return parts.every(Boolean) ? STORAGE_PREFIX + parts.join(':') : undefined
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** The toggles stored under `key`, or none (no storage, nothing stored, or unreadable) */
export function readStoredToggles(key: string | undefined): StoredToggles | undefined {
  if (!key) return undefined
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'collapsed' in parsed &&
      'expanded' in parsed &&
      isStringArray(parsed.collapsed) &&
      isStringArray(parsed.expanded)
    ) {
      return {collapsed: parsed.collapsed, expanded: parsed.expanded}
    }
  } catch {
    // Storage can be unavailable (private windows, blocked site data): just don't remember
  }
  return undefined
}

function writeStoredToggles(key: string | undefined, toggles: StoredToggles): void {
  if (!key) return
  try {
    if (toggles.collapsed.length || toggles.expanded.length) {
      window.localStorage.setItem(key, JSON.stringify(toggles))
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // See readStoredToggles
  }
}

/** Ids of the items stored with `collapsed: true` */
export function getDefaultCollapsedKeys(items: Item[], childrenField: string): Set<string> {
  const keys = new Set<string>()
  walkTree(
    items,
    (item, id) => {
      if (item.collapsed) keys.add(id)
    },
    childrenField,
  )
  return keys
}

/** The collapsed items to start with: the stored `collapsed: true`, then the user's own toggles */
export function getInitialCollapsedKeys(
  items: Item[],
  childrenField: string,
  stored: StoredToggles | undefined,
): Set<string> {
  const keys = getDefaultCollapsedKeys(items, childrenField)
  for (const id of stored?.collapsed ?? []) keys.add(id)
  for (const id of stored?.expanded ?? []) keys.delete(id)
  return keys
}

/** The user's toggles to remember: the items they toggled that are still in the tree */
export function getTogglesToStore(
  toggled: ReadonlySet<string>,
  collapsedKeys: ReadonlySet<string>,
  validIds: ReadonlySet<string>,
): StoredToggles {
  const toggles: StoredToggles = {collapsed: [], expanded: []}
  for (const id of toggled) {
    if (!validIds.has(id)) continue
    if (collapsedKeys.has(id)) toggles.collapsed.push(id)
    else toggles.expanded.push(id)
  }
  return toggles
}

interface Options {
  items: Item[]
  childrenField: string
  /** The Studio's focus path, relative to the tree's array */
  focusPath: Path | undefined
  /** Where to remember the user's toggles (`undefined`: don't remember them) */
  storageKey: string | undefined
}

export interface CollapsedItems {
  collapsedKeys: ReadonlySet<string>
  /** The user expands or collapses an item */
  toggle: (id: string) => void
  /** Shows an item's children, as if the user expanded it (an item was added or dropped in it) */
  expand: (id: string) => void
  /** Forgets an item that's being removed, with everything inside it */
  forget: (id: string) => void
}

/**
 * Which items are collapsed. Items start collapsed when their stored value has `collapsed: true`,
 * unless the user expanded them: the user's own toggles win, and are remembered in the browser
 * for the next time the document opens. Collapsed items open when the Studio focuses something
 * inside them (e.g. jumping to a validation error).
 */
export function useCollapsedItems({
  items,
  childrenField,
  focusPath,
  storageKey,
}: Options): CollapsedItems {
  const [stored] = useState(() => readStoredToggles(storageKey))
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() =>
    getInitialCollapsedKeys(items, childrenField, stored),
  )
  // Items the user toggled: the stored `collapsed: true` mustn't override them
  const toggledRef = useRef<Set<string>>(
    new Set([...(stored?.collapsed ?? []), ...(stored?.expanded ?? [])]),
  )
  // Items expanded to show the focus: the stored `collapsed: true` mustn't collapse them again
  const [focusExpandedIds, setFocusExpandedIds] = useState<ReadonlySet<string>>(() => new Set())

  // Items stored with `collapsed: true` later (added, or changed by someone else) start collapsed,
  // and items that are gone are forgotten
  useEffect(() => {
    const defaultCollapsedKeys = getDefaultCollapsedKeys(items, childrenField)
    const validIds = new Set<string>()
    walkTree(items, (_item, id) => void validIds.add(id), childrenField)

    setCollapsedKeys((currentKeys) => {
      const nextKeys = new Set([...currentKeys].filter((id) => validIds.has(id)))
      for (const id of defaultCollapsedKeys) {
        if (!toggledRef.current.has(id) && !focusExpandedIds.has(id)) nextKeys.add(id)
      }
      const changed =
        nextKeys.size !== currentKeys.size || [...nextKeys].some((id) => !currentKeys.has(id))
      return changed ? nextKeys : currentKeys
    })
  }, [childrenField, focusExpandedIds, items])

  // Remember the user's toggles (only the ones for items still in the tree)
  useEffect(() => {
    if (!storageKey) return
    const validIds = new Set<string>()
    walkTree(items, (_item, id) => void validIds.add(id), childrenField)
    // Don't forget toggles while the document is still loading
    if (!validIds.size) return
    writeStoredToggles(storageKey, getTogglesToStore(toggledRef.current, collapsedKeys, validIds))
  }, [childrenField, collapsedKeys, items, storageKey])

  // When the Studio focuses something inside a collapsed item, expand the items around it.
  // Adjusting state while rendering, as React recommends for props. (Also the focus the document
  // opens with, e.g. an item's dialog from the URL: hence `null`.)
  const [previousFocusPath, setPreviousFocusPath] = useState<Path | undefined | null>(null)
  if (focusPath !== previousFocusPath) {
    setPreviousFocusPath(focusPath)
    // Every item on the path except the focused item itself
    const ancestors = getFocusItemIds(focusPath, childrenField).slice(0, -1)
    if (ancestors.some((id) => collapsedKeys.has(id))) {
      setFocusExpandedIds(new Set([...focusExpandedIds, ...ancestors]))
      setCollapsedKeys(new Set([...collapsedKeys].filter((id) => !ancestors.includes(id))))
    }
  }

  const toggle = useCallback((id: string) => {
    toggledRef.current.add(id)
    setCollapsedKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys)
      if (nextKeys.has(id)) nextKeys.delete(id)
      else nextKeys.add(id)
      return nextKeys
    })
  }, [])

  const expand = useCallback((id: string) => {
    toggledRef.current.add(id)
    setCollapsedKeys((currentKeys) => {
      if (!currentKeys.has(id)) return currentKeys
      const nextKeys = new Set(currentKeys)
      nextKeys.delete(id)
      return nextKeys
    })
  }, [])

  const forget = useCallback((id: string) => {
    const isInside = (key: string) => key === id || key.startsWith(`${id}/`)
    for (const key of toggledRef.current) {
      if (isInside(key)) toggledRef.current.delete(key)
    }
    setCollapsedKeys((currentKeys) => {
      const nextKeys = new Set([...currentKeys].filter((key) => !isInside(key)))
      return nextKeys.size === currentKeys.size ? currentKeys : nextKeys
    })
  }, [])

  return {collapsedKeys, toggle, expand, forget}
}
