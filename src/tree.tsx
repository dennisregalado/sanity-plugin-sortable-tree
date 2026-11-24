import {DragDropProvider} from '@dnd-kit/react'
import {Box, Card, Grid, Stack, Text} from '@sanity/ui'
import {useToast} from '@sanity/ui/toast'
import {randomKey} from '@sanity/util/content'
import {toString as pathToString} from '@sanity/util/paths'
import React, {useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {
  type ArrayOfObjectsInputProps,
  type ArrayOfObjectsItemMember,
  type FieldMember,
  type FormPatch,
  getPublishedId,
  type Path,
  setIfMissing,
  useCurrentUser,
  useDataset,
  useFormValue,
  useProjectId,
  useSource,
  useTranslation,
} from 'sanity'

import {
  getCollapsedLists,
  getCollapseLimit,
  getParentId,
  getWorkspaceCollapseLimit,
  listKey,
  ROOT_LIST,
  withoutHidden,
} from './collapse-lists'
import {CollapsibleSubtree} from './collapsible-subtree'
import {sortableTreeLocaleNamespace} from './i18n'
import {ItemsToggle} from './items-toggle'
import {type RenderCallbacks} from './member-preview'
import {NewTreeItem} from './new-tree-item'
import {
  getAppendPatches,
  getArrayAt,
  getChildrenPath,
  getRemovePatches,
  type PatchInput,
  prefixItemPatches,
} from './patches'
import {
  canArrayContainType,
  getAddableTypes,
  getArrayMemberType,
  getChildMembers,
  getChildrenArrayType,
  getFieldMember,
  isItemMember,
  isReferenceType,
} from './schema-types'
import {TreeItem} from './tree-item'
import type {FlattenedItem, Item} from './types'
import {useCanHover} from './use-can-hover'
import {getStorageKey, useCollapsedItems} from './use-collapsed-items'
import {useRowWindowing} from './use-row-windowing'
import {useTreeDrag} from './use-tree-drag'
import {
  DEFAULT_CHILDREN_FIELD,
  flattenTree,
  getChildItems,
  getFocusItemIds,
  getTreeItemId,
  isRecord,
  isTreeItem,
  walkTree,
} from './utils'

interface Props {
  items: Item[]
  indentation?: number
  /** Called with patches relative to the root array */
  onPatch: (patches: FormPatch[]) => void
  /**
   * Called with the path of an item to open, and the path of its first field to focus (both
   * relative to the root array)
   */
  onItemOpen?: (path: Path, focusPath?: Path) => void
  maxDepth?: number
  /** The field holding each item's nested items */
  childrenField?: string
  /** When true, no items can be added, moved or removed */
  readOnly?: boolean
  props: ArrayOfObjectsInputProps
}

type TreeNodePosition = Pick<FlattenedItem, 'id' | 'parentId' | 'depth' | 'index' | 'collapsed'>

interface TreeRenderNode extends TreeNodePosition {
  children: TreeRenderNode[]
}

const ROW_STYLE: React.CSSProperties = {listStyle: 'none'}

/** Trees with more rows than this only mount the rows near the viewport (see useRowWindowing) */
const WINDOWING_THRESHOLD = 150

// Row geometry, for placeholder heights of rows that haven't been on screen yet
const ROW_HEIGHT = 51
const ROW_GAP = 4
/** A nested list's "Add item" button, or its "Show all N items" toggle */
const LIST_ROW_HEIGHT = 33

/** Whether `children` holds data the tree skips: not an array, items without keys, or repeated keys */
function hasUnshowableChildren(children: unknown): boolean {
  if (children === undefined || children === null) return false
  if (!Array.isArray(children)) return true

  const keys = new Set<string>()
  for (const child of children) {
    if (!isTreeItem(child) || keys.has(child._key)) return true
    keys.add(child._key)
  }
  return false
}

function buildRenderTree(flattenedItems: FlattenedItem[]): TreeRenderNode[] {
  const rootChildren: TreeRenderNode[] = []
  const nodes = new Map<string, TreeRenderNode>()

  for (const {id, parentId, depth, index, collapsed} of flattenedItems) {
    nodes.set(id, {id, parentId, depth, index, collapsed, children: []})
  }

  for (const item of flattenedItems) {
    const node = nodes.get(item.id)
    if (!node) continue

    if (item.parentId === null) rootChildren.push(node)
    else nodes.get(item.parentId)?.children.push(node)
  }

  return rootChildren
}

/** Where the user's expanded and collapsed items are remembered for this tree */
function useCollapseStorageKey(path: Path): string | undefined {
  const documentId = useFormValue(['_id'])
  const projectId = useProjectId()
  const dataset = useDataset()
  const user = useCurrentUser()

  return getStorageKey([
    projectId,
    dataset,
    user?.id,
    // The same for the draft, the published document and its versions
    typeof documentId === 'string' ? getPublishedId(documentId) : undefined,
    pathToString(path),
  ])
}

/** A ref holding the latest `value`, for event handlers that must stay the same between renders */
function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

export function Tree({
  items,
  props,
  indentation = 50,
  onPatch,
  onItemOpen,
  maxDepth = 3,
  childrenField = DEFAULT_CHILDREN_FIELD,
  readOnly = false,
}: Props): React.JSX.Element {
  // A reference that was just added: its row focuses the reference search, like the Studio's array
  const [addedReferenceId, setAddedReferenceId] = useState<string | null>(null)
  const toast = useToast()
  const canHover = useCanHover()
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const {
    focusPath,
    members,
    path,
    renderAnnotation,
    renderBlock,
    renderField,
    renderInlineBlock,
    renderInput,
    renderItem,
    renderPreview,
    resolveInitialValue,
    schemaType,
  } = props
  // Sanity's own array options apply to the whole tree
  const sortable = schemaType.options?.sortable !== false
  const disabledActions = schemaType.options?.disableActions
  const addDisabled = disabledActions?.includes('add') ?? false
  const removeDisabled = disabledActions?.includes('remove') ?? false
  const renderCallbacks = useMemo<RenderCallbacks>(
    () => ({
      renderAnnotation,
      renderBlock,
      renderField,
      renderInlineBlock,
      renderInput,
      renderItem,
      renderPreview,
    }),
    [
      renderAnnotation,
      renderBlock,
      renderField,
      renderInlineBlock,
      renderInput,
      renderItem,
      renderPreview,
    ],
  )

  // Every item's form member, by tree id. At any depth: items nested deeper than `maxDepth`
  // (e.g. written through the API) still show, so they can be moved up or removed.
  const memberById = useMemo(() => {
    const next = new Map<string, ArrayOfObjectsItemMember>()
    const visit = (list: ArrayOfObjectsItemMember[], parentId: string | null) => {
      for (const member of list) {
        const id = getTreeItemId(parentId, member.key)
        next.set(id, member)
        visit(getChildMembers(member, childrenField), id)
      }
    }
    visit(members.filter(isItemMember), null)
    return next
  }, [childrenField, members])

  /** The array type of a list: the tree's field for the root, an item's nested list otherwise */
  const getListType = useCallback(
    (parentId: string | null) =>
      parentId === null
        ? schemaType
        : getChildrenArrayType(memberById.get(parentId)?.item.schemaType, childrenField),
    [childrenField, memberById, schemaType],
  )

  const {
    collapsedKeys,
    toggle: toggleCollapsed,
    expand,
    forget,
  } = useCollapsedItems({items, childrenField, focusPath, storageKey: useCollapseStorageKey(path)})

  // "Show all N items": every list (the root and each item's children) shows the first items up
  // to its limit, like the Studio's arrays. The array field's `options.collapseItemsAfter` (the
  // tree field for the root, the nested list's field otherwise) wins over the workspace's
  // `form.arrays.collapseItems`.
  // oxlint-disable-next-line typescript/no-deprecated -- internal: the workspace's form config
  const source = useSource()
  const workspaceCollapseLimit = getWorkspaceCollapseLimit(source.form?.arrays?.collapseItems)
  const getListLimit = useCallback(
    (parentId: string | null) => getCollapseLimit(getListType(parentId), workspaceCollapseLimit),
    [getListType, workspaceCollapseLimit],
  )
  // Lists showing all their items (keys from `listKey`)
  const [expandedLists, setExpandedLists] = useState<ReadonlySet<string>>(() => new Set())
  const collapsedLists = useMemo(
    () => getCollapsedLists(items, getListLimit, expandedLists, childrenField),
    [childrenField, expandedLists, getListLimit, items],
  )
  const expandList = useCallback((key: string) => {
    setExpandedLists((current) => (current.has(key) ? current : new Set([...current, key])))
  }, [])
  const handleToggleList = useCallback((key: string) => {
    setExpandedLists((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // The focused item and its parents (tree ids), from the Studio's focus path
  const focusedItemIds = useMemo(
    () => getFocusItemIds(focusPath, childrenField),
    [childrenField, focusPath],
  )
  // Show the lists the focus is hidden in (past their "Show all N items"). Adjusting state while
  // rendering, as React recommends for props.
  const [previousFocusedItemIds, setPreviousFocusedItemIds] = useState<string[] | null>(null)
  if (focusedItemIds !== previousFocusedItemIds) {
    setPreviousFocusedItemIds(focusedItemIds)
    const hiddenOnPath = focusedItemIds.filter((id) => collapsedLists.hidden.has(id))
    if (hiddenOnPath.length) {
      setExpandedLists(
        new Set([...expandedLists, ...hiddenOnPath.map((id) => listKey(getParentId(id)))]),
      )
    }
  }

  const treeMeta = useMemo(() => {
    const hasChildren = new Set<string>()
    // Items with nested data the tree can't show (and won't write to)
    const hasInvalidChildren = new Set<string>()
    const pathById = new Map<string, Path>()

    walkTree(
      items,
      (item, id, parentId) => {
        const parentPath = parentId === null ? null : (pathById.get(parentId) ?? null)
        pathById.set(id, [...getChildrenPath(parentPath, childrenField), {_key: item._key}])

        if (getChildItems(item, childrenField).length > 0) hasChildren.add(id)
        if (hasUnshowableChildren(item[childrenField])) hasInvalidChildren.add(id)
      },
      childrenField,
    )

    return {hasChildren, hasInvalidChildren, pathById}
  }, [childrenField, items])

  const canMoveItemToParent = useCallback(
    (item: FlattenedItem, parentId: string | null) => {
      const typeName =
        typeof item._type === 'string' ? item._type : memberById.get(item.id)?.item.schemaType.name
      return canArrayContainType(getListType(parentId), typeName)
    },
    [getListType, memberById],
  )

  // Only items whose schema type has a nested list can be dropped into: never references
  const canHaveChildren = useCallback(
    (item: FlattenedItem) =>
      getChildrenArrayType(memberById.get(item.id)?.item.schemaType, childrenField) !== undefined,
    [childrenField, memberById],
  )

  const canAddItemToParent = useCallback(
    (parentId: string | null) => {
      if (readOnly || addDisabled) return false

      if (parentId !== null) {
        const parent = memberById.get(parentId)?.item
        if (!parent || parent.readOnly) return false
        if (getFieldMember(parent.members, childrenField)?.field.readOnly) return false
      }

      return getAddableTypes(getListType(parentId)).length > 0
    },
    [addDisabled, childrenField, getListType, memberById, readOnly],
  )

  const baseDragItems = useMemo(
    () =>
      withoutHidden(flattenTree(items, collapsedKeys, true, childrenField), collapsedLists.hidden),
    [childrenField, collapsedKeys, collapsedLists, items],
  )
  const baseRenderItems = useMemo(
    () =>
      withoutHidden(flattenTree(items, collapsedKeys, false, childrenField), collapsedLists.hidden),
    [childrenField, collapsedKeys, collapsedLists, items],
  )

  // The tree's root element: windowing observes its rows, drag feedback animates them
  const containerRef = useRef<HTMLDivElement>(null)
  const getPath = useCallback((id: string) => treeMeta.pathById.get(id), [treeMeta])
  const drag = useTreeDrag({
    containerRef,
    items,
    dragItems: baseDragItems,
    childrenField,
    indentation,
    maxDepth,
    canHaveChildren,
    canMoveItemToParent,
    getPath,
    onPatch,
    onDropInto: expand,
    t,
  })
  const {projectedItems, dragSource, cancelProjection} = drag
  const activeDragItemId = dragSource?.item.id ?? null
  const dragItems = projectedItems ?? baseDragItems
  const renderItems = projectedItems ?? baseRenderItems
  const renderTree = useMemo(() => buildRenderTree(renderItems), [renderItems])
  const windowing = useRowWindowing(
    containerRef,
    renderItems.length > WINDOWING_THRESHOLD,
    baseRenderItems.map((item) => item.id),
  )
  const dragIndexById = useMemo(
    () => new Map(dragItems.map((item, index) => [item.id, index])),
    [dragItems],
  )
  const optimisticParentId = useMemo(() => {
    if (!activeDragItemId || !projectedItems) return null
    return projectedItems.find((item) => item.id === activeDragItemId)?.parentId ?? null
  }, [activeDragItemId, projectedItems])

  // The row handlers read what they need from here, so they stay the same between renders and
  // editing one item doesn't re-render every row
  const latest = useLatest({
    canAddItemToParent,
    childrenField,
    getListLimit,
    getListType,
    items,
    memberById,
    onItemOpen,
    onPatch,
    resolveInitialValue,
    t,
    toast,
    treeMeta,
  })

  const handleCollapse = useCallback(
    (id: string) => {
      cancelProjection()
      toggleCollapsed(id)
    },
    [cancelProjection, toggleCollapsed],
  )

  const handleAddItem = useCallback(
    (parentId: string | null, typeName?: string) => {
      const current = latest.current
      cancelProjection()

      if (!current.canAddItemToParent(parentId)) return

      const itemType = getArrayMemberType(current.getListType(parentId), typeName)
      const parentPath = parentId === null ? null : current.treeMeta.pathById.get(parentId)
      if (!itemType || parentPath === undefined) return

      const childrenPath = getChildrenPath(parentPath, current.childrenField)
      const key = randomKey(12)
      const itemPath: Path = [...childrenPath, {_key: key}]

      current.onPatch(getAppendPatches({_key: key, _type: itemType.name}, childrenPath))
      // The new item goes last: show the whole list, like the Studio's arrays do for a new item
      if (getArrayAt(current.items, childrenPath).length + 1 > current.getListLimit(parentId)) {
        expandList(listKey(parentId))
      }
      setAddedReferenceId(isReferenceType(itemType) ? getTreeItemId(parentId, key) : null)
      if (parentId !== null) expand(parentId)

      // Like the Studio's own array input: insert right away, then fill in the schema's
      // initial value. `setIfMissing` keeps anything the user typed in the meantime.
      const applyInitialValue = async () => {
        try {
          const initialValue: unknown = await current.resolveInitialValue(itemType, {})
          const fields = Object.entries(isRecord(initialValue) ? initialValue : {}).filter(
            ([name, value]) => name !== '_key' && name !== '_type' && value !== undefined,
          )

          if (fields.length) {
            current.onPatch(fields.map(([name, value]) => setIfMissing(value, [...itemPath, name])))
          }
        } catch (error) {
          current.toast.push({
            status: 'error',
            title: current.t('initial-value-error.title'),
            description: error instanceof Error ? error.message : String(error),
          })
        }
      }
      void applyInitialValue()
    },
    [cancelProjection, expand, expandList, latest],
  )

  const handleItemOpen = useCallback(
    (id: string) => {
      const current = latest.current
      const itemPath = current.treeMeta.pathById.get(id)
      if (!current.onItemOpen || !itemPath) return

      // Focus the first field, as the tree always has (fieldsets and groups aren't fields)
      const firstField = current.memberById
        .get(id)
        ?.item.members.find((member): member is FieldMember => member.kind === 'field')?.name

      current.onItemOpen(itemPath, firstField ? [...itemPath, firstField] : undefined)
    },
    [latest],
  )

  const handleItemPatch = useCallback(
    (id: string, patches: PatchInput) => {
      const current = latest.current
      const itemPath = current.treeMeta.pathById.get(id)
      if (itemPath) current.onPatch(prefixItemPatches(patches, itemPath))
    },
    [latest],
  )

  const handleRemove = useCallback(
    (id: string) => {
      const current = latest.current
      cancelProjection()

      const itemPath = current.treeMeta.pathById.get(id)
      if (!itemPath) return

      forget(id)
      current.onPatch(getRemovePatches(itemPath))
    },
    [cancelProjection, forget, latest],
  )

  /** Whether an item's nested list starts with its own "Add item" button */
  const hasAddRow = (node: TreeNodePosition) =>
    node.depth < maxDepth - 1 && canAddItemToParent(node.id)

  /** Estimated height of a row with its (expanded) subtree, before it's been on screen */
  const estimateHeight = (node: TreeRenderNode): number => {
    if (!node.children.length || collapsedKeys.has(node.id)) return ROW_HEIGHT

    const listRows = (hasAddRow(node) ? 1 : 0) + (collapsedLists.collapsible.has(node.id) ? 1 : 0)
    const children = node.children.reduce((sum, child) => sum + estimateHeight(child) + ROW_GAP, 0)
    // The subtree's top margin takes the place of the gap after its last row
    return ROW_HEIGHT + listRows * (LIST_ROW_HEIGHT + ROW_GAP) + children
  }

  function renderTreeNode(node: TreeRenderNode, disabled = false): React.ReactNode {
    const member = memberById.get(node.id)
    const nestable = getChildrenArrayType(member?.item.schemaType, childrenField) !== undefined
    const hasChildren = nestable && (treeMeta.hasChildren.has(node.id) || node.children.length > 0)
    const isCollapsed = collapsedKeys.has(node.id)
    const isOptimisticParent = optimisticParentId === node.id && node.children.length > 0
    const isDraggingTree = activeDragItemId === node.id && (dragSource?.children.length ?? 0) > 0
    // The dragged row and the focused row (and the rows containing them) always stay mounted
    const isDragPath =
      activeDragItemId !== null &&
      (activeDragItemId === node.id || activeDragItemId.startsWith(`${node.id}/`))
    const isFocusPath = focusedItemIds.includes(node.id)

    if (!windowing.isVisible(node.id) && !isDragPath && !isFocusPath) {
      return (
        <li key={`item-${node.id}`} data-tree-id={node.id} style={ROW_STYLE}>
          <div aria-hidden style={{height: windowing.heightOf(node.id) ?? estimateHeight(node)}} />
        </li>
      )
    }

    return (
      <li key={`item-${node.id}`} data-tree-id={node.id} style={ROW_STYLE}>
        {member && (
          <TreeItem
            item={{...node, collapsed: isCollapsed}}
            member={member}
            index={dragIndexById.get(node.id) ?? node.index}
            disabled={disabled || !dragIndexById.has(node.id)}
            hasChildren={hasChildren}
            childrenField={childrenField}
            onCollapse={handleCollapse}
            onItemOpen={onItemOpen ? handleItemOpen : undefined}
            onItemPatch={handleItemPatch}
            autoFocusSearch={addedReferenceId === node.id}
            onRemove={removeDisabled ? undefined : handleRemove}
            sortable={sortable}
            canHover={canHover}
            callbacks={renderCallbacks}
            // Items with children add to their nested list with its own "Add item" button
            onAddChild={!hasChildren && hasAddRow(node) ? handleAddItem : undefined}
            childTypes={getAddableTypes(getListType(node.id))}
          />
        )}
        {treeMeta.hasInvalidChildren.has(node.id) && !isDraggingTree && (
          <Box style={{marginTop: '0.25rem', marginLeft: indentation}}>
            <Card tone="caution" padding={2} radius={2} border>
              <Text size={1}>{t('invalid-children')}</Text>
            </Card>
          </Box>
        )}
        {hasChildren && !isDraggingTree && (
          <CollapsibleSubtree open={!isCollapsed || isOptimisticParent}>
            {(subtreeDisabled) => (
              <Grid
                gap={1}
                as="ul"
                style={{
                  listStyle: 'none',
                  marginTop: '0.25rem',
                  marginLeft: indentation,
                  padding: 0,
                }}
              >
                {/* First in the list, like Shopify's "Add block" in its theme editor's tree */}
                {hasAddRow(node) && (
                  <li key={`add-${node.id}`} style={ROW_STYLE}>
                    <NewTreeItem
                      inline
                      addItem={handleAddItem}
                      disabled={disabled || subtreeDisabled}
                      parentId={node.id}
                      types={getAddableTypes(getListType(node.id))}
                    />
                  </li>
                )}
                {node.children.map((child) => renderTreeNode(child, disabled || subtreeDisabled))}
                {collapsedLists.collapsible.has(node.id) && (
                  <li key={`toggle-${node.id}`} style={ROW_STYLE}>
                    <ItemsToggle
                      list={node.id}
                      count={collapsedLists.collapsible.get(node.id) ?? 0}
                      expanded={expandedLists.has(node.id)}
                      onToggle={handleToggleList}
                    />
                  </li>
                )}
              </Grid>
            )}
          </CollapsibleSubtree>
        )}
      </li>
    )
  }

  return (
    <DragDropProvider {...drag.providerProps}>
      <Stack gap={2}>
        <Card ref={containerRef} border padding={1} radius={2}>
          <Grid gap={1} as="ul" style={{listStyle: 'none', margin: 0, padding: 0}}>
            {renderTree.length ? (
              renderTree.map((node) => renderTreeNode(node))
            ) : (
              <Box padding={2} flex={1}>
                <Text size={1} muted>
                  {t('no-items')}
                </Text>
              </Box>
            )}

            {collapsedLists.collapsible.has(ROOT_LIST) && (
              <li style={ROW_STYLE}>
                <ItemsToggle
                  list={ROOT_LIST}
                  count={collapsedLists.collapsible.get(ROOT_LIST) ?? 0}
                  expanded={expandedLists.has(ROOT_LIST)}
                  onToggle={handleToggleList}
                />
              </li>
            )}
          </Grid>
        </Card>
        {/* Below the card, like the Studio's own array input */}
        {!addDisabled && (
          <NewTreeItem
            addItem={handleAddItem}
            disabled={!canAddItemToParent(null)}
            types={getAddableTypes(schemaType)}
          />
        )}
      </Stack>
    </DragDropProvider>
  )
}
