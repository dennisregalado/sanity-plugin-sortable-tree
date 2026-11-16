import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {DragDropProvider, DragOverlay} from '@dnd-kit/react'
import {isKeyboardEvent} from '@dnd-kit/dom/utilities'
import {randomKey} from '@sanity/util/content'
import {FlattenedItem, type Item} from './types'
import {
  flattenTree,
  buildTree,
  getProjection,
  getDragDepth,
  getDescendants,
  getTreeItemId,
  indexItemsById,
} from './utils'
import {TreeItem} from './tree-item'
import {TreeItemOverlay} from './tree-overlay'
import {NewTreeItem} from './new-tree-item'
import {Box, Card, Grid, Text} from '@sanity/ui'
import {
  ArrayOfObjectsItem,
  ArrayOfObjectsInputProps,
  ArrayOfObjectsMember,
  ObjectInputProps,
  type Path,
  SanityDefaultPreview,
} from 'sanity'

interface Props {
  items: Item[]
  indentation?: number
  onChange(items: Item[]): void
  onItemOpen?(path: Path): void
  members?: ArrayOfObjectsMember[]
  maxDepth?: number
  /** When true, no items can be added, moved or removed */
  readOnly?: boolean
  props: ArrayOfObjectsInputProps<any>
}

interface TreeRenderNode extends Omit<FlattenedItem, 'children'> {
  children: TreeRenderNode[]
}

const COLLAPSE_DURATION_MS = 250

function collectDefaultCollapsedKeys(items: Item[]) {
  const collapsedKeys = new Set<string>()

  const visitItems = (treeItems: Item[], parentId: string | null = null) => {
    treeItems.forEach((item, index) => {
      const id = getTreeItemId(parentId, item._key, index)
      const childCount = item.children?.length ?? 0

      if (item.collapsed) {
        collapsedKeys.add(id)
      }

      if (item.children && childCount > 0) {
        visitItems(item.children, id)
      }
    })
  }

  visitItems(items)

  return collapsedKeys
}

function flattenTreeForRender(
  items: Item[],
  collapsedKeys: ReadonlySet<string>,
  parentId: string | null = null,
  depth = 0,
): FlattenedItem[] {
  const flattenedItems: FlattenedItem[] = []

  const walk = (
    treeItems: Item[] | undefined,
    currentParentId: string | null,
    currentDepth: number,
  ) => {
    if (!treeItems) return

    treeItems.forEach((item, index) => {
      const id = getTreeItemId(currentParentId, item._key, index)
      const collapsed = collapsedKeys.has(id)

      flattenedItems.push({
        ...item,
        id,
        collapsed,
        parentId: currentParentId,
        depth: currentDepth,
        index,
      })
      walk(item.children, id, currentDepth + 1)
    })
  }

  walk(items, parentId, depth)

  return flattenedItems
}

function buildRenderTree(flattenedItems: FlattenedItem[]): TreeRenderNode[] {
  const rootChildren: TreeRenderNode[] = []
  const nodes = new Map<string, TreeRenderNode>()

  for (const item of flattenedItems) {
    nodes.set(item.id, {...item, children: []})
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

function getChildrenArraySchemaType(objectSchemaType: any) {
  const childrenField = objectSchemaType?.fields?.find((field: any) => field?.name === 'children')
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

function createItemForArraySchema(arraySchemaType: any): Item | null {
  const itemSchemaType = getArrayMemberSchemaType(arraySchemaType)
  const itemTypeName = getSchemaTypeName(itemSchemaType)

  if (!itemTypeName) return null

  return {
    _key: randomKey(12),
    _type: itemTypeName,
    ...(getChildrenArraySchemaType(itemSchemaType) ? {children: []} : {}),
  }
}

function CollapsibleSubtree({
  open,
  children,
}: {
  open: boolean
  children(disabled: boolean): React.ReactNode
}) {
  const [, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)

  useEffect(() => {
    const animationFrames: number[] = []
    let unmountTimeout: ReturnType<typeof setTimeout> | undefined

    if (open) {
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
      <div style={{minHeight: 0, overflow: 'hidden'}}>{children(!open)}</div>
    </div>
  )
}

export function Tree({
  items,
  members,
  props,
  indentation = 50,
  onChange,
  onItemOpen,
  maxDepth = 3,
  readOnly = false,
}: Props) {
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() =>
    collectDefaultCollapsedKeys(items),
  )
  const [projectedItems, setProjectedItems] = useState<FlattenedItem[] | null>(null)
  const [hoveredItemKey, setHoveredItemKey] = useState<string | null>(null)
  const [activeDragItemId, setActiveDragItemId] = useState<string | null>(null)
  const projectedItemsRef = useRef<FlattenedItem[] | null>(null)
  const manuallyToggledCollapsedKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const defaultCollapsedKeys = collectDefaultCollapsedKeys(items)
    const validKeys = new Set<string>()

    const visitItems = (treeItems: Item[], parentId: string | null = null) => {
      treeItems.forEach((item, index) => {
        const id = getTreeItemId(parentId, item._key, index)

        validKeys.add(id)

        if (item.children?.length) {
          visitItems(item.children, id)
        }
      })
    }

    visitItems(items)

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
        if (!manuallyToggledCollapsedKeysRef.current.has(key) && !nextKeys.has(key)) {
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
  }, [items])

  // Original values by tree id, used to rebuild the value without losing fields on reorder/remove
  const itemById = useMemo(() => indexItemsById(items), [items])
  const baseDragItems = useMemo(() => flattenTree(items, collapsedKeys), [collapsedKeys, items])
  const baseRenderItems = useMemo(
    () => flattenTreeForRender(items, collapsedKeys),
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

  const updateProjectedItems = useCallback((nextItems: FlattenedItem[] | null) => {
    projectedItemsRef.current = nextItems
    setProjectedItems(nextItems)
  }, [])

  const memberById = useMemo(() => {
    const next = new Map<string, any>()

    const visitMember = (
      member: any,
      depth = 0,
      parentProps: any = props,
      parentId: string | null = null,
      index = 0,
    ) => {
      if (!member) return

      const id = member.key ? getTreeItemId(parentId, member.key, index) : null

      if (member.key) {
        next.set(id!, {...member, parentProps})
      }

      if (depth >= maxDepth) return

      const childrenMenu = member?.item?.members?.find((m: any) => m.name === 'children')
      const children = childrenMenu?.field?.members

      if (!children) return

      children.forEach((child: any, childIndex: number) => {
        visitMember(child, depth + 1, childrenMenu.field, id, childIndex)
      })
    }

    members?.forEach((member, index) => visitMember(member, 0, props, null, index))

    return next
  }, [maxDepth, members, props])

  const treeMeta = useMemo(() => {
    const hasChildren = new Set<string>()
    const pathById = new Map<string, Path>()

    const visitItems = (
      treeItems: Item[],
      currentPath: Path = [],
      parentId: string | null = null,
    ) => {
      treeItems.forEach((item, index) => {
        const id = getTreeItemId(parentId, item._key, index)
        const itemPath: Path = [...currentPath, {_key: item._key}]

        pathById.set(id, itemPath)

        if (item.children?.length) {
          hasChildren.add(id)
          visitItems(item.children, [...itemPath, 'children'], id)
        }
      })
    }

    visitItems(items)

    return {hasChildren, pathById}
  }, [items])

  const getDestinationArraySchemaType = useCallback(
    (parentId: string | null) => {
      if (parentId === null) {
        return props.schemaType
      }

      return getChildrenArraySchemaType(memberById.get(parentId)?.item?.schemaType)
    },
    [memberById, props.schemaType],
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
      if (readOnly) return false

      if (parentId !== null) {
        const parentItem = memberById.get(parentId)?.item
        const childrenField = parentItem?.members?.find(
          (m: {kind?: string; name?: string}) => m.kind === 'field' && m.name === 'children',
        )?.field

        if (parentItem?.readOnly || childrenField?.readOnly) return false
      }

      return createItemForArraySchema(getDestinationArraySchemaType(parentId)) !== null
    },
    [getDestinationArraySchemaType, memberById, readOnly],
  )

  const sanitizeTreeItems = useCallback(
    (treeItems: Item[]) => {
      return sanitizeItems(treeItems, props.schemaType)
    },
    [props.schemaType],
  )

  const initialDepth = useRef(0)
  const sourceItem = useRef<FlattenedItem | null>(null)
  const sourceChildren = useRef<FlattenedItem[]>([])
  const sourceDescendantDepth = useRef(0)

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
    (parentId: string | null) => {
      updateProjectedItems(null)

      if (!canAddItemToParent(parentId)) return

      const newItem = createItemForArraySchema(getDestinationArraySchemaType(parentId))

      if (!newItem) return

      if (parentId === null) {
        // Adding to root level
        const newItems = [...items, newItem]
        onChange(sanitizeTreeItems(newItems))
      } else {
        // Adding to a parent item
        const addToParent = (
          items: Item[],
          targetParentId: string,
          currentParentId: string | null = null,
        ): Item[] => {
          return items.map((item, index) => {
            const id = getTreeItemId(currentParentId, item._key, index)

            if (id === targetParentId) {
              return {
                ...item,
                children: [...(Array.isArray(item.children) ? item.children : []), newItem],
              }
            }
            if (item.children && Array.isArray(item.children) && item.children.length > 0) {
              return {
                ...item,
                children: addToParent(item.children, targetParentId, id),
              }
            }
            return item
          })
        }

        const newItems = addToParent(items, parentId)
        const nextCollapsedKeys = new Set(collapsedKeys)

        manuallyToggledCollapsedKeysRef.current.add(parentId)
        nextCollapsedKeys.delete(parentId)
        setCollapsedKeys(nextCollapsedKeys)
        onChange(sanitizeTreeItems(newItems))
      }
    },
    [
      canAddItemToParent,
      collapsedKeys,
      getDestinationArraySchemaType,
      items,
      onChange,
      sanitizeTreeItems,
      updateProjectedItems,
    ],
  )

  const handleItemOpen = useCallback(
    (id: string) => {
      if (!onItemOpen) return

      const itemPath = treeMeta.pathById.get(id)
      const firstFieldName = memberById.get(id)?.item?.members?.[0]?.name

      if (!itemPath) return

      onItemOpen(firstFieldName ? [...itemPath, firstFieldName] : itemPath)
    },
    [memberById, onItemOpen, treeMeta],
  )

  const handleRemove = useCallback(
    (id: string) => {
      updateProjectedItems(null)

      const descendants = getDescendants(dragItems, id)
      const newItems = dragItems.filter((item) => item.id !== id && !descendants.has(item.id))
      const tree = buildTree(newItems, itemById)
      const remainingIds = new Set(newItems.map((item) => item.id))
      const nextCollapsedKeys = new Set(
        [...collapsedKeys].filter((key) => key !== id && remainingIds.has(key)),
      )

      setCollapsedKeys(nextCollapsedKeys)
      onChange(sanitizeTreeItems(tree))
    },
    [collapsedKeys, dragItems, itemById, onChange, sanitizeTreeItems, updateProjectedItems],
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
      const isDraggingTree = activeDragItemId === node.id && sourceChildren.current.length > 0

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
              isHovering={hoveredItemKey === node.id}
              onHoverChange={setHoveredItemKey}
              onCollapse={handleCollapse}
              onItemOpen={onItemOpen ? handleItemOpen : undefined}
              onRemove={handleRemove}
            >
              <ArrayOfObjectsItem
                member={{
                  ...member,
                  item: {
                    ...member.item,
                    schemaType: {
                      ...member.item.schemaType,
                      components: {
                        ...member.item.schemaType.components,
                        item: TreeItemInput,
                        preview: TreeItemPreview,
                      },
                    },
                  },
                }}
                renderAnnotation={props.renderAnnotation}
                renderBlock={props.renderBlock}
                renderField={props.renderField}
                renderInlineBlock={props.renderInlineBlock}
                renderInput={props.renderInput}
                renderItem={props.renderItem}
                renderPreview={props.renderPreview}
              />
            </TreeItem>
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
      collapsedKeys,
      dragIndexById,
      handleAddItem,
      handleCollapse,
      handleItemOpen,
      handleRemove,
      hoveredItemKey,
      indentation,
      maxDepth,
      memberById,
      onItemOpen,
      optimisticParentId,
      props,
      treeMeta,
    ],
  )

  return (
    <DragDropProvider
      onDragStart={(event) => {
        const {source} = event.operation

        if (!source) return

        const activeItems = projectedItemsRef.current ?? dragItems
        const draggedItem = activeItems.find(({id}) => id === String(source.id))

        if (!draggedItem) return

        const {depth} = draggedItem

        // Store the source item's initial depth for later use
        initialDepth.current = depth
        sourceItem.current = draggedItem
        setActiveDragItemId(draggedItem.id)
        sourceChildren.current = []
        sourceDescendantDepth.current = 0

        // Get all visible descendants of the source item
        const descendants = getDescendants(activeItems, source.id)

        updateProjectedItems(
          activeItems.filter((item) => {
            if (descendants.has(item.id)) {
              sourceChildren.current = [...sourceChildren.current, item]
              sourceDescendantDepth.current = Math.max(
                sourceDescendantDepth.current,
                item.depth - draggedItem.depth,
              )
              return false
            }

            return true
          }),
        )
      }}
      onDragOver={(event, manager) => {
        const {source, target} = event.operation

        event.preventDefault()

        if (source && target && source.id !== target.id) {
          const activeItems = projectedItemsRef.current ?? dragItems
          const offsetLeft = manager.dragOperation.transform.x
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

        if (source && target) {
          const keyboard = isKeyboardEvent(event.operation.activatorEvent)
          const currentDepth = source.data!.depth ?? 0
          let keyboardDepth

          if (keyboard) {
            const isHorizontal = event.by?.x !== 0 && event.by?.y === 0

            if (isHorizontal) {
              event.preventDefault()

              keyboardDepth = currentDepth + Math.sign(event.by!.x)
            }
          }

          const offsetLeft = manager.dragOperation.transform.x
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

          if (source.data!.depth !== depth || source.data!.parentId !== parentId) {
            const movedItem = activeItems.find((item) => item.id === String(source.id))

            if (!movedItem || !canMoveItemToParent(movedItem, parentId)) {
              return
            }

            updateProjectedItems(
              activeItems.map((item) =>
                item.id === String(source.id) ? {...item, depth, parentId} : item,
              ),
            )
          }
        }
      }}
      onDragEnd={(event) => {
        if (event.canceled) {
          sourceItem.current = null
          setActiveDragItemId(null)
          sourceChildren.current = []
          sourceDescendantDepth.current = 0
          updateProjectedItems(null)

          return
        }

        const activeItems = projectedItemsRef.current ?? dragItems
        const restoredItems = restoreSourceChildren(activeItems)

        if (!restoredItems.every((item) => canMoveItemToParent(item, item.parentId))) {
          sourceItem.current = null
          setActiveDragItemId(null)
          sourceChildren.current = []
          sourceDescendantDepth.current = 0
          updateProjectedItems(null)

          return
        }

        const movedItem = sourceItem.current
          ? restoredItems.find((item) => item.id === sourceItem.current?.id)
          : undefined
        const updatedTree = buildTree(restoredItems, itemById)

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

        onChange(sanitizeTreeItems(updatedTree))
        sourceItem.current = null
        setActiveDragItemId(null)
        sourceChildren.current = []
        sourceDescendantDepth.current = 0
        updateProjectedItems(null)
      }}
    >
      <Card border padding={1} radius={2}>
        <Grid gap={1} as="ul" style={{listStyle: 'none', margin: 0, padding: 0}}>
          {renderTree.length ? (
            renderTree.map((node) => renderTreeNode(node))
          ) : (
            <Box padding={2} flex={1}>
              <Text size={1} muted>
                No items
              </Text>
            </Box>
          )}

          <li style={{listStyle: 'none'}}>
            <NewTreeItem addItem={handleAddItem} disabled={!canAddItemToParent(null)} />
          </li>
        </Grid>
      </Card>
      <DragOverlay style={{width: '100%'}}>
        {(overlayProps) => {
          const item =
            sourceItem.current ?? dragItems.find(({id}) => id === String(overlayProps.id))
          const member = item ? memberById.get(item.id) : undefined

          return (
            <TreeItemOverlay
              descendants={sourceChildren.current}
              hasChildren={item ? treeMeta.hasChildren.has(item.id) : false}
              item={item}
              preview={
                member?.kind === 'item' ? (
                  <ArrayOfObjectsItem
                    member={{
                      ...member,
                      item: {
                        ...member.item,
                        schemaType: {
                          ...member.item.schemaType,
                          components: {
                            ...member.item.schemaType.components,
                            item: TreeItemInput,
                            preview: TreeItemPreview,
                          },
                        },
                      },
                    }}
                    renderAnnotation={props.renderAnnotation}
                    renderBlock={props.renderBlock}
                    renderField={props.renderField}
                    renderInlineBlock={props.renderInlineBlock}
                    renderInput={props.renderInput}
                    renderItem={props.renderItem}
                    renderPreview={props.renderPreview}
                  />
                ) : null
              }
            />
          )
        }}
      </DragOverlay>
    </DragDropProvider>
  )
}

function sanitizeItems(items: Item[], arraySchemaType?: any): Item[] {
  return items.map((item) => {
    // Tree bookkeeping is already removed by `buildTree`. Don't delete keys like `id`, `index` or
    // `collapsed` here: they can be real fields in the user's schema.
    const sanitizedItem: Item = {
      ...item,
    }
    const itemSchemaType = getArrayMemberSchemaType(
      arraySchemaType,
      typeof item._type === 'string' ? item._type : undefined,
    )
    const childrenArraySchemaType = getChildrenArraySchemaType(itemSchemaType)
    const children = Array.isArray(item.children) ? item.children : []

    if (childrenArraySchemaType && children.length > 0) {
      sanitizedItem.children = sanitizeItems(children, childrenArraySchemaType)
    } else {
      delete sanitizedItem.children
    }

    return sanitizedItem
  })
}

function TreeItemInput(props: any) {
  return props.inputProps.renderPreview(props.inputProps)
}

function TreeItemPreview(
  props: ObjectInputProps & {
    title?: React.ReactNode
    media?: React.ReactNode
    icon?: React.ComponentType
  },
) {
  const value = props.value as Item | undefined
  const childCount = Array.isArray(value?.children) ? value.children.length : 0

  if (childCount > 0) {
    return (
      <SanityDefaultPreview
        title={props.title || 'Untitled'}
        media={props.media}
        subtitle={`${childCount} item${childCount === 1 ? '' : 's'}`}
      />
    )
  }

  return (
    <SanityDefaultPreview layout="compact" title={props.title || 'Untitled'} media={props.media} />
  )
}
