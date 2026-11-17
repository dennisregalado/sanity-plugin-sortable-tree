import {configure} from '@dnd-kit/abstract'
import {Accessibility, defaultPreset, Feedback} from '@dnd-kit/dom'
import {isKeyboardEvent} from '@dnd-kit/dom/utilities'
import {DragDropProvider} from '@dnd-kit/react'
import {DoubleChevronDownIcon} from '@sanity/icons/DoubleChevronDown'
import {DoubleChevronUpIcon} from '@sanity/icons/DoubleChevronUp'
import {Box, Button, Card, Flex, Grid, Text} from '@sanity/ui'
import {useToast} from '@sanity/ui/toast'
import {Tooltip} from '@sanity/ui/tooltip'
import {randomKey} from '@sanity/util/content'
import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {
  type ArrayOfObjectsInputProps,
  type ArrayOfObjectsMember,
  type FormPatch,
  type Path,
  setIfMissing,
  useTranslation,
} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import {keepDraggedRowLifted, restrictToList, snapToDepth} from './drag-feedback'
import {type RenderCallbacks} from './member-preview'
import {type AddableType, NewTreeItem} from './new-tree-item'
import {
  CHILDREN_FIELD,
  getAppendPatches,
  getChildrenPath,
  getMovePatches,
  getRemovePatches,
} from './patches'
import {TreeItem} from './tree-item'
import {useDragFlip} from './use-drag-flip'
import {FlattenedItem, type Item} from './types'
import {
  flattenTree,
  getDescendants,
  getDragDepth,
  getProjection,
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
  members?: ArrayOfObjectsMember[]
  maxDepth?: number
  /** When true, no items can be added, moved or removed */
  readOnly?: boolean
  props: ArrayOfObjectsInputProps<any>
}

type TreeNodePosition = Pick<FlattenedItem, 'id' | 'parentId' | 'depth' | 'index' | 'collapsed'>

interface TreeRenderNode extends TreeNodePosition {
  children: TreeRenderNode[]
}

const COLLAPSE_DURATION_MS = 250

/**
 * Tree ids of the items that must be expanded to show `focusPath` (relative to the root array):
 * every item on the path except the last one, which is the focused item itself.
 */
function getFocusAncestorIds(focusPath: Path | undefined): string[] {
  const ids: string[] = []
  let id: string | null = null

  for (let index = 0; index < (focusPath?.length ?? 0); index += 2) {
    const segment = focusPath?.[index]
    if (!segment || typeof segment !== 'object' || !('_key' in segment)) break

    id = id ? `${id}/${segment._key}` : segment._key
    ids.push(id)
    if (focusPath?.[index + 1] !== CHILDREN_FIELD) break
  }

  return ids.slice(0, -1)
}

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

// The dragged row settles into place (and follows keyboard moves) like the Studio's array items,
// which use their sort transition for this (sanity/src/core/form/inputs/arrays/common/list.tsx)
const SETTLE_TRANSITION = {duration: 200, easing: 'ease'}

/** The hidden copy dnd-kit leaves in the dragged row's place, where it will be dropped */
function getDropPlaceholder(element: Element | undefined): Element | null {
  return element?.ownerDocument.querySelector('[data-dnd-placeholder]') ?? null
}

/** The visible title of a draggable row, for screen reader announcements */
function getRowTitle(element: Element | undefined): string {
  return element?.textContent?.trim() || ''
}

function collectDefaultCollapsedKeys(items: Item[]) {
  const collapsedKeys = new Set<string>()

  walkTree(items, (item, id) => {
    if (item.collapsed) {
      collapsedKeys.add(id)
    }
  })

  return collapsedKeys
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

    if (item.parentId === null) {
      rootChildren.push(node)
      continue
    }

    nodes.get(item.parentId)?.children.push(node)
  }

  return rootChildren
}

function getSchemaTypeName(schemaType: any): string | undefined {
  return typeof schemaType?.name === 'string' ? schemaType.name : undefined
}

function getArrayMemberSchemaTypes(arraySchemaType: any): any[] {
  return Array.isArray(arraySchemaType?.of) ? arraySchemaType.of : []
}

function getArrayMemberSchemaType(arraySchemaType: any, typeName?: string) {
  const memberTypes = getArrayMemberSchemaTypes(arraySchemaType)

  if (typeName) {
    return memberTypes.find((memberType) => getSchemaTypeName(memberType) === typeName)
  }

  return memberTypes.length === 1 ? memberTypes[0] : undefined
}

const addableTypesCache = new WeakMap<object, AddableType[]>()

/** The item types that can be added to an array, cached so memoized buttons stay stable */
function getAddableTypes(arraySchemaType: any): AddableType[] {
  if (!arraySchemaType || typeof arraySchemaType !== 'object') return []

  let types = addableTypesCache.get(arraySchemaType)
  if (!types) {
    types = getArrayMemberSchemaTypes(arraySchemaType).flatMap((memberType) => {
      const name = getSchemaTypeName(memberType)
      return name ? [{name, title: memberType.title || name, icon: memberType.icon}] : []
    })
    addableTypesCache.set(arraySchemaType, types)
  }
  return types
}

function getChildrenArraySchemaType(objectSchemaType: any) {
  const childrenField = objectSchemaType?.fields?.find(
    (field: any) => field?.name === CHILDREN_FIELD,
  )
  const childrenType = childrenField?.type

  return Array.isArray(childrenType?.of) ? childrenType : undefined
}

function getItemTypeName(item: Item, member?: any) {
  return typeof item._type === 'string' ? item._type : getSchemaTypeName(member?.item?.schemaType)
}

function canArrayContainItemType(arraySchemaType: any, itemTypeName?: string) {
  const memberTypes = getArrayMemberSchemaTypes(arraySchemaType)

  if (!itemTypeName) {
    return memberTypes.length === 1
  }

  return memberTypes.some((memberType) => getSchemaTypeName(memberType) === itemTypeName)
}

function CollapsibleSubtree({
  open,
  children,
}: {
  open: boolean
  children: (disabled: boolean) => React.ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)

  useEffect(() => {
    const animationFrames: number[] = []
    let unmountTimeout: ReturnType<typeof setTimeout> | undefined

    if (open) {
      // Collapse first, then expand on the next frames so the transition plays (also on mount).
      // oxlint-disable-next-line react/set-state-in-effect -- drives the CSS transition
      setMounted(true)
      setExpanded(false)
      animationFrames.push(
        requestAnimationFrame(() => {
          animationFrames.push(requestAnimationFrame(() => setExpanded(true)))
        }),
      )
    } else {
      setExpanded(false)
      animationFrames.push(
        requestAnimationFrame(() => {
          unmountTimeout = setTimeout(() => setMounted(false), COLLAPSE_DURATION_MS)
        }),
      )
    }

    return () => {
      for (const animationFrame of animationFrames) {
        cancelAnimationFrame(animationFrame)
      }

      if (unmountTimeout !== undefined) {
        clearTimeout(unmountTimeout)
      }
    }
  }, [open])

  return (
    <div
      aria-hidden={!open}
      style={{
        display: 'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        opacity: expanded ? 1 : 0,
        overflow: 'hidden',
        transition: `grid-template-rows ${COLLAPSE_DURATION_MS}ms ease, opacity ${COLLAPSE_DURATION_MS}ms ease`,
        willChange: 'grid-template-rows, opacity',
      }}
    >
      <div style={{minHeight: 0, overflow: 'hidden'}}>{mounted ? children(!open) : null}</div>
    </div>
  )
}

export function Tree({
  items,
  members,
  props,
  indentation = 50,
  onPatch,
  onItemOpen,
  maxDepth = 3,
  readOnly = false,
}: Props) {
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() =>
    collectDefaultCollapsedKeys(items),
  )
  // Items expanded to show the focus: the stored `collapsed: true` mustn't collapse them again
  const [focusExpandedIds, setFocusExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [projectedItems, setProjectedItems] = useState<FlattenedItem[] | null>(null)
  // The dragged item and its children, for rendering (the refs below are for event handlers)
  const [dragSource, setDragSource] = useState<{
    item: FlattenedItem
    children: FlattenedItem[]
  } | null>(null)
  const activeDragItemId = dragSource?.item.id ?? null
  const projectedItemsRef = useRef<FlattenedItem[] | null>(null)
  const manuallyToggledCollapsedKeysRef = useRef<Set<string>>(new Set())
  const toast = useToast()
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const {
    focusPath,
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
  // dnd-kit's default plugins, with announcements that use item titles and the Studio's locale
  const dragPlugins = useMemo(
    () => [
      ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility && plugin !== Feedback),
      // No drag overlay: the dragged row itself is lifted and moves with the pointer
      configure(Feedback, {
        dropAnimation: SETTLE_TRANSITION,
        keyboardTransition: SETTLE_TRANSITION,
      }),
      configure(Accessibility, {
        screenReaderInstructions: {draggable: t('announce.instructions')},
        announcements: {
          dragstart: ({operation: {source}}) =>
            source ? t('announce.drag-start', {title: getRowTitle(source.element)}) : undefined,
          dragover: ({operation: {source, target}}) =>
            source && target
              ? t('announce.drag-over', {
                  title: getRowTitle(source.element),
                  target: getRowTitle(target.element),
                })
              : undefined,
          dragend: ({operation: {source}, canceled}) =>
            source
              ? t(canceled ? 'announce.drag-cancel' : 'announce.drag-end', {
                  title: getRowTitle(source.element),
                })
              : undefined,
        },
      }),
    ],
    [t],
  )
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

  useEffect(() => {
    const defaultCollapsedKeys = collectDefaultCollapsedKeys(items)
    const validKeys = new Set<string>()

    walkTree(items, (_item, id) => {
      validKeys.add(id)
    })

    setCollapsedKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys)
      let changed = false

      for (const key of nextKeys) {
        if (!validKeys.has(key)) {
          nextKeys.delete(key)
          changed = true
        }
      }

      for (const key of defaultCollapsedKeys) {
        if (
          !manuallyToggledCollapsedKeysRef.current.has(key) &&
          !focusExpandedIds.has(key) &&
          !nextKeys.has(key)
        ) {
          nextKeys.add(key)
          changed = true
        }
      }

      return changed ? nextKeys : currentKeys
    })

    for (const key of manuallyToggledCollapsedKeysRef.current) {
      if (!validKeys.has(key)) {
        manuallyToggledCollapsedKeysRef.current.delete(key)
      }
    }
  }, [focusExpandedIds, items])

  const baseDragItems = useMemo(() => flattenTree(items, collapsedKeys), [collapsedKeys, items])
  const baseRenderItems = useMemo(
    () => flattenTree(items, collapsedKeys, false),
    [collapsedKeys, items],
  )
  const dragItems = projectedItems ?? baseDragItems
  const renderItems = projectedItems ?? baseRenderItems
  const renderTree = useMemo(() => buildRenderTree(renderItems), [renderItems])
  const dragIndexById = useMemo(() => {
    const next = new Map<string, number>()

    for (const [index, item] of dragItems.entries()) {
      next.set(item.id, index)
    }

    return next
  }, [dragItems])
  const optimisticParentId = useMemo(() => {
    if (!activeDragItemId || !projectedItems) {
      return null
    }

    return projectedItems.find((item) => item.id === activeDragItemId)?.parentId ?? null
  }, [activeDragItemId, projectedItems])

  // Set by keyboard moves: moves the dragged row to its new position after it renders
  const followSourceRef = useRef<(() => void) | null>(null)
  // Rows slide out of the way of the dragged row
  const treeRef = useRef<HTMLDivElement | null>(null)
  const dragFlip = useDragFlip(treeRef)

  // After every render while dragging: slide the rows that moved. dnd-kit calls the drag handlers
  // in a transition, so the form's own update (from a drop's patches) can render before the
  // projection does: then note where the rows are again, for the projection's render.
  useLayoutEffect(() => {
    keepDraggedRowLifted(treeRef.current)
    dragFlip.play()
    if (projectedItemsRef.current !== projectedItems) dragFlip.snapshot()
  })

  useLayoutEffect(() => {
    const follow = followSourceRef.current
    followSourceRef.current = null
    follow?.()
  }, [projectedItems])

  const updateProjectedItems = useCallback(
    (nextItems: FlattenedItem[] | null) => {
      // While dragging: note where the rows are, to slide them from there once React moves them
      if (nextItems || projectedItemsRef.current) dragFlip.snapshot()
      projectedItemsRef.current = nextItems
      setProjectedItems(nextItems)
    },
    [dragFlip],
  )

  const memberById = useMemo(() => {
    const next = new Map<string, any>()

    const visitMember = (member: any, depth = 0, parentId: string | null = null) => {
      if (!member) return

      const id = member.key ? (parentId ? `${parentId}/${member.key}` : member.key) : null

      if (id) {
        next.set(id, member)
      }

      if (depth >= maxDepth) return

      const childrenMenu = member?.item?.members?.find(
        (m: any) => m.kind === 'field' && m.name === CHILDREN_FIELD,
      )
      const children = childrenMenu?.field?.members

      if (!children) return

      children.forEach((child: any) => {
        visitMember(child, depth + 1, id)
      })
    }

    members?.forEach((member) => visitMember(member, 0, null))

    return next
  }, [maxDepth, members])

  const treeMeta = useMemo(() => {
    const hasChildren = new Set<string>()
    // Items with nested data the tree can't show (and won't write to)
    const hasInvalidChildren = new Set<string>()
    const pathById = new Map<string, Path>()

    walkTree(items, (item, id, parentId) => {
      const parentPath = parentId === null ? null : (pathById.get(parentId) ?? null)

      pathById.set(id, [...getChildrenPath(parentPath), {_key: item._key}])

      if (Array.isArray(item.children) && item.children.length > 0) {
        hasChildren.add(id)
      }
      if (hasUnshowableChildren(item.children)) {
        hasInvalidChildren.add(id)
      }
    })

    return {hasChildren, hasInvalidChildren, pathById}
  }, [items])

  const getDestinationArraySchemaType = useCallback(
    (parentId: string | null) => {
      if (parentId === null) {
        return schemaType
      }

      return getChildrenArraySchemaType(memberById.get(parentId)?.item?.schemaType)
    },
    [memberById, schemaType],
  )

  const canMoveItemToParent = useCallback(
    (item: FlattenedItem, parentId: string | null) => {
      const destinationArraySchemaType = getDestinationArraySchemaType(parentId)
      const itemTypeName = getItemTypeName(item, memberById.get(item.id))

      return canArrayContainItemType(destinationArraySchemaType, itemTypeName)
    },
    [getDestinationArraySchemaType, memberById],
  )

  const canAddItemToParent = useCallback(
    (parentId: string | null) => {
      if (readOnly || addDisabled) return false

      if (parentId !== null) {
        const parentItem = memberById.get(parentId)?.item
        const childrenField = parentItem?.members?.find(
          (m: {kind?: string; name?: string}) => m.kind === 'field' && m.name === CHILDREN_FIELD,
        )?.field

        if (parentItem?.readOnly || childrenField?.readOnly) return false
      }

      return getAddableTypes(getDestinationArraySchemaType(parentId)).length > 0
    },
    [addDisabled, getDestinationArraySchemaType, memberById, readOnly],
  )

  const initialDepth = useRef(0)
  const sourceItem = useRef<FlattenedItem | null>(null)
  const sourceChildren = useRef<FlattenedItem[]>([])
  const sourceDescendantDepth = useRef(0)

  // The dragged row moves vertically with the pointer, at the indentation of its projected depth
  const getDragOffsetX = useCallback(() => {
    const source = sourceItem.current
    const projected = source && projectedItemsRef.current?.find(({id}) => id === source.id)

    return projected ? (projected.depth - initialDepth.current) * indentation : null
  }, [indentation])
  const getTreeElement = useCallback(() => treeRef.current, [])
  const dragModifiers = useMemo(
    // oxlint-disable-next-line react/refs -- dnd-kit calls these during drags, not while rendering
    () => [snapToDepth(getDragOffsetX), restrictToList(getTreeElement)],
    [getDragOffsetX, getTreeElement],
  )

  const handleExpandAll = useCallback(() => {
    updateProjectedItems(null)
    for (const id of treeMeta.hasChildren) manuallyToggledCollapsedKeysRef.current.add(id)
    setCollapsedKeys(new Set())
  }, [treeMeta, updateProjectedItems])

  const handleCollapseAll = useCallback(() => {
    updateProjectedItems(null)
    for (const id of treeMeta.hasChildren) manuallyToggledCollapsedKeysRef.current.add(id)
    setCollapsedKeys(new Set(treeMeta.hasChildren))
  }, [treeMeta, updateProjectedItems])

  // When the Studio focuses something inside a collapsed item (e.g. jumping to a validation error),
  // expand the items around it. Adjusting state while rendering, as React recommends for props.
  const [previousFocusPath, setPreviousFocusPath] = useState(focusPath)
  if (focusPath !== previousFocusPath) {
    setPreviousFocusPath(focusPath)
    const ancestors = getFocusAncestorIds(focusPath)
    if (ancestors.some((id) => collapsedKeys.has(id))) {
      setFocusExpandedIds(new Set([...focusExpandedIds, ...ancestors]))
      setCollapsedKeys(new Set([...collapsedKeys].filter((id) => !ancestors.includes(id))))
    }
  }

  const handleCollapse = useCallback(
    (id: string) => {
      updateProjectedItems(null)
      manuallyToggledCollapsedKeysRef.current.add(id)
      setCollapsedKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys)

        if (nextKeys.has(id)) {
          nextKeys.delete(id)
        } else {
          nextKeys.add(id)
        }

        return nextKeys
      })
    },
    [updateProjectedItems],
  )

  const handleAddItem = useCallback(
    (parentId: string | null, typeName?: string) => {
      updateProjectedItems(null)

      if (!canAddItemToParent(parentId)) return

      const itemSchemaType = getArrayMemberSchemaType(
        getDestinationArraySchemaType(parentId),
        typeName,
      )
      const parentPath = parentId === null ? null : treeMeta.pathById.get(parentId)

      if (!itemSchemaType || parentPath === undefined) return

      const childrenPath = getChildrenPath(parentPath)
      const key = randomKey(12)
      const itemPath: Path = [...childrenPath, {_key: key}]

      onPatch(getAppendPatches({_key: key, _type: itemSchemaType.name}, childrenPath))

      if (parentId !== null) {
        manuallyToggledCollapsedKeysRef.current.add(parentId)
        setCollapsedKeys((currentKeys) => {
          if (!currentKeys.has(parentId)) return currentKeys

          const nextKeys = new Set(currentKeys)
          nextKeys.delete(parentId)
          return nextKeys
        })
      }

      // Like the Studio's own array input: insert right away, then fill in the schema's
      // initial value. `setIfMissing` keeps anything the user typed in the meantime.
      const applyInitialValue = async () => {
        try {
          const initialValue: unknown = await resolveInitialValue(itemSchemaType, {})
          const fields = Object.entries(isRecord(initialValue) ? initialValue : {}).filter(
            ([name, value]) => name !== '_key' && name !== '_type' && value !== undefined,
          )

          if (fields.length) {
            onPatch(fields.map(([name, value]) => setIfMissing(value, [...itemPath, name])))
          }
        } catch (error) {
          toast.push({
            status: 'error',
            title: t('initial-value-error.title'),
            description: error instanceof Error ? error.message : String(error),
          })
        }
      }
      void applyInitialValue()
    },
    [
      canAddItemToParent,
      getDestinationArraySchemaType,
      onPatch,
      resolveInitialValue,
      t,
      toast,
      treeMeta,
      updateProjectedItems,
    ],
  )

  const handleItemOpen = useCallback(
    (id: string) => {
      if (!onItemOpen) return

      const itemPath = treeMeta.pathById.get(id)

      if (!itemPath) return

      // Focus the first field, as the tree always has (fieldsets and groups aren't fields)
      const firstField = memberById
        .get(id)
        ?.item?.members?.find((m: {kind?: string}) => m.kind === 'field')?.name

      onItemOpen(itemPath, firstField ? [...itemPath, firstField] : undefined)
    },
    [memberById, onItemOpen, treeMeta],
  )

  const handleRemove = useCallback(
    (id: string) => {
      updateProjectedItems(null)

      const path = treeMeta.pathById.get(id)

      if (!path) return

      setCollapsedKeys((currentKeys) => {
        const nextKeys = new Set(
          [...currentKeys].filter((key) => key !== id && !key.startsWith(`${id}/`)),
        )
        return nextKeys.size === currentKeys.size ? currentKeys : nextKeys
      })
      onPatch(getRemovePatches(path))
    },
    [onPatch, treeMeta, updateProjectedItems],
  )

  const restoreSourceChildren = useCallback((activeItems: FlattenedItem[]) => {
    if (!sourceItem.current || !sourceChildren.current.length) {
      return activeItems
    }

    const sourceIndex = activeItems.findIndex((item) => item.id === sourceItem.current?.id)
    const movedSource = activeItems[sourceIndex]

    if (sourceIndex === -1 || !movedSource) {
      return activeItems
    }

    const sourceChildIds = new Set(sourceChildren.current.map((item) => item.id))
    const depthOffset = movedSource.depth - sourceItem.current.depth
    const baseItems = activeItems.filter((item) => !sourceChildIds.has(item.id))
    const nextSourceIndex = baseItems.findIndex((item) => item.id === movedSource.id)
    const restoredChildren = sourceChildren.current.map((item) => ({
      ...item,
      depth: item.depth + depthOffset,
      parentId: item.parentId === sourceItem.current?.id ? movedSource.id : item.parentId,
    }))

    return [
      ...baseItems.slice(0, nextSourceIndex + 1),
      ...restoredChildren,
      ...baseItems.slice(nextSourceIndex + 1),
    ]
  }, [])

  const renderTreeNode = useCallback(
    function renderTreeNode(node: TreeRenderNode, disabled = false): React.ReactNode {
      const member = memberById.get(node.id)
      const canHaveChildren = getChildrenArraySchemaType(member?.item?.schemaType) !== undefined
      const hasRealChildren = treeMeta.hasChildren.has(node.id)
      const hasChildren = canHaveChildren && (hasRealChildren || node.children.length > 0)
      const isCollapsed = collapsedKeys.has(node.id)
      const isOptimisticParent = optimisticParentId === node.id && node.children.length > 0
      const sortableIndex = dragIndexById.get(node.id) ?? node.index
      const sortableDisabled = disabled || !dragIndexById.has(node.id)
      const isDraggingTree = activeDragItemId === node.id && (dragSource?.children.length ?? 0) > 0

      return (
        <li
          key={`item-${node.id}`}
          style={{
            listStyle: 'none',
          }}
        >
          {member?.kind === 'item' && (
            <TreeItem
              item={{...node, collapsed: isCollapsed}}
              member={member}
              index={sortableIndex}
              disabled={sortableDisabled}
              hasChildren={hasChildren}
              onCollapse={handleCollapse}
              onItemOpen={onItemOpen ? handleItemOpen : undefined}
              onRemove={removeDisabled ? undefined : handleRemove}
              sortable={sortable}
              callbacks={renderCallbacks}
              // Items without a visible nested "Add item" button (no children yet, or collapsed)
              onAddChild={
                (!hasRealChildren || isCollapsed) &&
                node.depth < maxDepth - 1 &&
                canAddItemToParent(node.id)
                  ? handleAddItem
                  : undefined
              }
              childTypes={getAddableTypes(getChildrenArraySchemaType(member.item.schemaType))}
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
                  {node.children.map((child) => renderTreeNode(child, disabled || subtreeDisabled))}
                  {hasRealChildren && node.depth < maxDepth - 1 && canAddItemToParent(node.id) && (
                    <li key={`add-${node.id}`} style={{listStyle: 'none'}}>
                      <NewTreeItem
                        addItem={handleAddItem}
                        disabled={disabled || subtreeDisabled}
                        parentId={node.id}
                        types={getAddableTypes(getDestinationArraySchemaType(node.id))}
                      />
                    </li>
                  )}
                </Grid>
              )}
            </CollapsibleSubtree>
          )}
        </li>
      )
    },
    [
      activeDragItemId,
      canAddItemToParent,
      dragSource,
      getDestinationArraySchemaType,
      collapsedKeys,
      dragIndexById,
      handleAddItem,
      handleCollapse,
      handleItemOpen,
      handleRemove,
      indentation,
      maxDepth,
      memberById,
      onItemOpen,
      optimisticParentId,
      removeDisabled,
      renderCallbacks,
      sortable,
      t,
      treeMeta,
    ],
  )

  return (
    <DragDropProvider
      plugins={dragPlugins}
      modifiers={dragModifiers}
      onDragStart={(event) => {
        const {source} = event.operation

        if (!source) return

        const activeItems = projectedItemsRef.current ?? dragItems
        const draggedItem = activeItems.find(({id}) => id === String(source.id))

        if (!draggedItem) return

        const {depth} = draggedItem

        // Visible descendants move with the item: take them out of the list while dragging
        const descendants = getDescendants(activeItems, source.id)
        const children = activeItems.filter((item) => descendants.has(item.id))

        // Store the source item's initial depth for later use
        initialDepth.current = depth
        sourceItem.current = draggedItem
        sourceChildren.current = children
        sourceDescendantDepth.current = Math.max(
          0,
          ...children.map((item) => item.depth - draggedItem.depth),
        )
        setDragSource({item: draggedItem, children})

        updateProjectedItems(activeItems.filter((item) => !descendants.has(item.id)))
      }}
      onDragOver={(event, manager) => {
        const {source, target} = event.operation

        event.preventDefault()

        // Keyboard drags move by position in the tree (onDragMove), not by what they're over
        if (isKeyboardEvent(event.operation.activatorEvent)) return

        if (source && target && source.id !== target.id) {
          const activeItems = projectedItemsRef.current ?? dragItems
          // The pointer's own offset: the dragged row's (`transform`) snaps to the projected depth
          const offsetLeft = manager.dragOperation.position.delta.x
          const dragDepth = getDragDepth(offsetLeft, indentation)
          const projectedDepth = initialDepth.current + dragDepth

          const {depth, parentId} = getProjection(
            activeItems,
            target.id,
            projectedDepth,
            maxDepth - sourceDescendantDepth.current,
          )

          const sourceIndex = activeItems.findIndex((item) => item.id === String(source.id))
          const targetIndex = activeItems.findIndex((item) => item.id === String(target.id))

          if (sourceIndex !== -1 && targetIndex !== -1) {
            const newItems = [...activeItems]
            const [movedItem] = newItems.splice(sourceIndex, 1)

            if (!canMoveItemToParent(movedItem, parentId)) {
              return
            }

            newItems.splice(targetIndex, 0, {...movedItem, depth, parentId})

            updateProjectedItems(newItems)
          }
        }
      }}
      onDragMove={(event, manager) => {
        if (event.defaultPrevented) {
          return
        }

        const {source, target} = event.operation

        // Up/down arrow keys: move one position in the tree, keeping the depth where possible
        if (
          source &&
          isKeyboardEvent(event.operation.activatorEvent) &&
          event.by &&
          event.by.y !== 0 &&
          event.by.x === 0
        ) {
          event.preventDefault()

          const activeItems = projectedItemsRef.current ?? dragItems
          const index = activeItems.findIndex((item) => item.id === String(source.id))
          const nextIndex = index + Math.sign(event.by.y)
          const movedItem = activeItems[index]

          if (!movedItem || nextIndex < 0 || nextIndex >= activeItems.length) return

          const nextItems = activeItems.filter((item) => item !== movedItem)
          nextItems.splice(nextIndex, 0, movedItem)

          const {depth, parentId} = getProjection(
            nextItems,
            movedItem.id,
            movedItem.depth,
            maxDepth - sourceDescendantDepth.current,
          )

          if (!canMoveItemToParent(movedItem, parentId)) return

          nextItems[nextIndex] = {...movedItem, depth, parentId}

          // Move the dragged row to where it will be dropped, once React has placed it there (the
          // row itself is lifted out of the list, so measure the placeholder left in its place)
          const before = getDropPlaceholder(source.element)?.getBoundingClientRect()
          followSourceRef.current = () => {
            const after = getDropPlaceholder(source.element)?.getBoundingClientRect()

            if (before && after) {
              manager.actions.move({
                // Horizontally, one indentation per level, as with the left/right arrow keys
                by: {x: indentation * (depth - movedItem.depth), y: after.top - before.top},
                propagate: false,
              })
            }
          }
          updateProjectedItems(nextItems)

          return
        }

        if (source && target) {
          const keyboard = isKeyboardEvent(event.operation.activatorEvent)
          const currentDepth = source.data.depth ?? 0
          let keyboardDepth

          if (keyboard) {
            const isHorizontal = event.by?.x !== 0 && event.by?.y === 0

            if (isHorizontal) {
              event.preventDefault()

              keyboardDepth = currentDepth + Math.sign(event.by!.x)
            }
          }

          // The pointer's own offset: the dragged row's (`transform`) snaps to the projected depth
          const offsetLeft = manager.dragOperation.position.delta.x
          const dragDepth = getDragDepth(offsetLeft, indentation)

          const projectedDepth = keyboardDepth ?? initialDepth.current + dragDepth

          const activeItems = projectedItemsRef.current ?? dragItems
          const {depth, parentId} = getProjection(
            activeItems,
            source.id,
            projectedDepth,
            maxDepth - sourceDescendantDepth.current,
          )

          if (keyboard) {
            if (currentDepth !== depth) {
              const offset = indentation * (depth - currentDepth)

              manager.actions.move({
                by: {x: offset, y: 0},
                propagate: false,
              })
            }
          }

          if (source.data.depth !== depth || source.data.parentId !== parentId) {
            const movedItem = activeItems.find((item) => item.id === String(source.id))

            if (!movedItem || !canMoveItemToParent(movedItem, parentId)) {
              return
            }

            const nextItems = [...activeItems]
            nextItems[nextItems.indexOf(movedItem)] = {...movedItem, depth, parentId}
            updateProjectedItems(nextItems)
          }
        }
      }}
      onDragEnd={(event) => {
        if (event.canceled) {
          sourceItem.current = null
          setDragSource(null)
          sourceChildren.current = []
          sourceDescendantDepth.current = 0
          updateProjectedItems(null)

          return
        }

        const activeItems = projectedItemsRef.current ?? dragItems
        const restoredItems = restoreSourceChildren(activeItems)

        if (!restoredItems.every((item) => canMoveItemToParent(item, item.parentId))) {
          sourceItem.current = null
          setDragSource(null)
          sourceChildren.current = []
          sourceDescendantDepth.current = 0
          updateProjectedItems(null)

          return
        }

        const movedItem = sourceItem.current
          ? restoredItems.find((item) => item.id === sourceItem.current?.id)
          : undefined
        const fromPath = movedItem ? treeMeta.pathById.get(movedItem.id) : undefined
        const parentPath =
          movedItem?.parentId == null ? null : treeMeta.pathById.get(movedItem.parentId)
        let movePatches: FormPatch[] = []

        if (movedItem && fromPath && parentPath !== undefined) {
          // Only the dragged item changes position: its children move with it
          const siblings = restoredItems.filter((item) => item.parentId === movedItem.parentId)
          const position = siblings.indexOf(movedItem)

          movePatches = getMovePatches(items, fromPath, {
            parentPath,
            afterKey: siblings[position - 1]?._key,
            beforeKey: siblings[position + 1]?._key,
          })
        }

        if (movedItem?.parentId) {
          manuallyToggledCollapsedKeysRef.current.add(movedItem.parentId)
          setCollapsedKeys((currentKeys) => {
            if (!currentKeys.has(movedItem.parentId!)) {
              return currentKeys
            }

            const nextKeys = new Set(currentKeys)

            nextKeys.delete(movedItem.parentId!)

            return nextKeys
          })
        }

        if (movePatches.length) onPatch(movePatches)
        sourceItem.current = null
        setDragSource(null)
        sourceChildren.current = []
        sourceDescendantDepth.current = 0
        updateProjectedItems(null)
      }}
    >
      <Card ref={treeRef} border padding={1} radius={2}>
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

          {treeMeta.hasChildren.size > 0 ? (
            // With nested items: "Expand all" / "Collapse all" next to "Add item"
            <li style={{listStyle: 'none'}}>
              <Flex gap={1}>
                {!addDisabled && (
                  <Box flex={1}>
                    <NewTreeItem
                      addItem={handleAddItem}
                      disabled={!canAddItemToParent(null)}
                      types={getAddableTypes(schemaType)}
                    />
                  </Box>
                )}
                <Tooltip
                  content={
                    <Text muted size={1}>
                      {t('expand-all')}
                    </Text>
                  }
                  animate
                  placement="top"
                  portal
                >
                  <Button
                    aria-label={t('expand-all')}
                    disabled={collapsedKeys.size === 0}
                    icon={DoubleChevronDownIcon}
                    mode="ghost"
                    padding={2}
                    onClick={handleExpandAll}
                  />
                </Tooltip>
                <Tooltip
                  content={
                    <Text muted size={1}>
                      {t('collapse-all')}
                    </Text>
                  }
                  animate
                  placement="top"
                  portal
                >
                  <Button
                    aria-label={t('collapse-all')}
                    disabled={[...treeMeta.hasChildren].every((id) => collapsedKeys.has(id))}
                    icon={DoubleChevronUpIcon}
                    mode="ghost"
                    padding={2}
                    onClick={handleCollapseAll}
                  />
                </Tooltip>
              </Flex>
            </li>
          ) : (
            !addDisabled && (
              <li style={{listStyle: 'none'}}>
                <NewTreeItem
                  addItem={handleAddItem}
                  disabled={!canAddItemToParent(null)}
                  types={getAddableTypes(schemaType)}
                />
              </li>
            )
          )}
        </Grid>
      </Card>
    </DragDropProvider>
  )
}
