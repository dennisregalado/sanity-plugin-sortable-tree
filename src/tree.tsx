import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {configure} from '@dnd-kit/abstract'
import {Accessibility, defaultPreset} from '@dnd-kit/dom'
import {DragDropProvider, DragOverlay} from '@dnd-kit/react'
import {isKeyboardEvent} from '@dnd-kit/dom/utilities'
import {randomKey} from '@sanity/util/content'
import {useToast} from '@sanity/ui/toast'
import {sortableTreeLocaleNamespace} from './i18n'
import {FlattenedItem, type Item} from './types'
import {flattenTree, getProjection, getDragDepth, getDescendants, walkTree} from './utils'
import {
  CHILDREN_FIELD,
  getAppendPatches,
  getChildrenPath,
  getMovePatches,
  getRemovePatches,
} from './patches'
import {MemberPreview, type RenderCallbacks} from './member-preview'
import {TreeItem} from './tree-item'
import {TreeItemOverlay} from './tree-overlay'
import {NewTreeItem} from './new-tree-item'
import {Box, Card, Grid, Text} from '@sanity/ui'
import {
  type ArrayOfObjectsInputProps,
  type ArrayOfObjectsMember,
  type FormPatch,
  type Path,
  setIfMissing,
  useTranslation,
} from 'sanity'

interface Props {
  items: Item[]
  indentation?: number
  /** Called with patches relative to the root array */
  onPatch(patches: FormPatch[]): void
  /**
   * Called with the path of an item to open, and the path of its first field to focus (both
   * relative to the root array)
   */
  onItemOpen?(path: Path, focusPath?: Path): void
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
  children(disabled: boolean): React.ReactNode
}) {
  const [mounted, setMounted] = useState(open)
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
  const [projectedItems, setProjectedItems] = useState<FlattenedItem[] | null>(null)
  const [activeDragItemId, setActiveDragItemId] = useState<string | null>(null)
  const projectedItemsRef = useRef<FlattenedItem[] | null>(null)
  const manuallyToggledCollapsedKeysRef = useRef<Set<string>>(new Set())
  const toast = useToast()
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const {
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
  // dnd-kit's default plugins, with announcements that use item titles and the Studio's locale
  const dragPlugins = useMemo(
    () => [
      ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
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

  const updateProjectedItems = useCallback((nextItems: FlattenedItem[] | null) => {
    projectedItemsRef.current = nextItems
    setProjectedItems(nextItems)
  }, [])

  const memberById = useMemo(() => {
    const next = new Map<string, any>()

    const visitMember = (member: any, depth = 0, parentId: string | null = null) => {
      if (!member) return

      const id = member.key ? (parentId ? `${parentId}/${member.key}` : member.key) : null

      if (member.key) {
        next.set(id!, member)
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
    const pathById = new Map<string, Path>()

    walkTree(items, (item, id, parentId) => {
      const parentPath = parentId === null ? null : (pathById.get(parentId) ?? null)

      pathById.set(id, [...getChildrenPath(parentPath), {_key: item._key}])

      if (Array.isArray(item.children) && item.children.length > 0) {
        hasChildren.add(id)
      }
    })

    return {hasChildren, pathById}
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
      if (readOnly) return false

      if (parentId !== null) {
        const parentItem = memberById.get(parentId)?.item
        const childrenField = parentItem?.members?.find(
          (m: {kind?: string; name?: string}) => m.kind === 'field' && m.name === CHILDREN_FIELD,
        )?.field

        if (parentItem?.readOnly || childrenField?.readOnly) return false
      }

      return getArrayMemberSchemaType(getDestinationArraySchemaType(parentId)) !== undefined
    },
    [getDestinationArraySchemaType, memberById, readOnly],
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

      const itemSchemaType = getArrayMemberSchemaType(getDestinationArraySchemaType(parentId))
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
      resolveInitialValue(itemSchemaType, {})
        .then((initialValue) => {
          const fields = Object.entries((initialValue ?? {}) as Record<string, unknown>).filter(
            ([name, value]) => name !== '_key' && name !== '_type' && value !== undefined,
          )

          if (fields.length) {
            onPatch(fields.map(([name, value]) => setIfMissing(value, [...itemPath, name])))
          }
        })
        .catch((error: unknown) => {
          toast.push({
            status: 'error',
            title: t('initial-value-error.title'),
            description: error instanceof Error ? error.message : String(error),
          })
        })
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
              onCollapse={handleCollapse}
              onItemOpen={onItemOpen ? handleItemOpen : undefined}
              onRemove={handleRemove}
              callbacks={renderCallbacks}
            />
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
      indentation,
      maxDepth,
      memberById,
      onItemOpen,
      optimisticParentId,
      renderCallbacks,
      treeMeta,
    ],
  )

  return (
    <DragDropProvider
      plugins={dragPlugins}
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
                {t('no-items')}
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
                  <MemberPreview member={member} callbacks={renderCallbacks} />
                ) : null
              }
            />
          )
        }}
      </DragOverlay>
    </DragDropProvider>
  )
}
