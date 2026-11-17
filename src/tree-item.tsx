import type {PluginConstructor} from '@dnd-kit/abstract'
import {useSortable} from '@dnd-kit/react/sortable'
import {ChevronDownIcon} from '@sanity/icons/ChevronDown'
import {ChevronRightIcon} from '@sanity/icons/ChevronRight'
import {DragHandleIcon} from '@sanity/icons/DragHandle'
import {Box, Button, Card, Flex, Text} from '@sanity/ui'
import {Tooltip} from '@sanity/ui/tooltip'
import type React from 'react'
import {memo, useMemo, useState} from 'react'
import {type ArrayOfObjectsItemMember, useTranslation} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import {
  type ArrayAction,
  type InsertEvent,
  NativeItem,
  type RenderCallbacks,
  type TreeRowActions,
  TreeRowProvider,
} from './native-item'
import {type AddableType, AddChildButton} from './new-tree-item'
import {FlattenedItem} from './types'

export interface Props {
  item: Pick<FlattenedItem, 'id' | 'collapsed' | 'depth' | 'parentId'>
  member: ArrayOfObjectsItemMember
  /** Render callbacks for the item */
  callbacks: RenderCallbacks
  index: number
  disabled?: boolean
  onRemove: (id: string) => void
  /** Inserts siblings of the item (the item menu's Duplicate and Add item before/after) */
  onInsert: (id: string, event: InsertEvent) => void
  onCollapse?: (id: string) => void
  hasChildren?: boolean
  onItemOpen: (id: string) => void
  /** The tree's `options.disableActions` (the same array for every row) */
  disabledActions: readonly ArrayAction[]
  /** Whether the pointer can hover (false on touch screens): measured once for the whole tree */
  canHover?: boolean
  /** False hides the drag handle (`options.sortable: false`) */
  sortable?: boolean
  /** Adds a nested item (with the type picked from `childTypes` when there are several) */
  onAddChild?: (id: string, typeName?: string) => void
  /**
   * Keeps room for the "Add nested item" button on every row, so the item's card doesn't change width
   * when the button appears on hover, and cards line up from row to row
   */
  addChildSlot?: boolean
  childTypes?: AddableType[]
}

const SORTABLE_PLUGINS: PluginConstructor[] = []
const NO_TYPES: AddableType[] = []

const config = {
  alignment: {
    x: 'start',
    y: 'center',
  },
  // The tree slides rows out of the way itself (useDragFlip): dnd-kit's transition only follows
  // index changes, and misses rows that move when the dragged row enters or leaves a nested list
  transition: null,
  // React owns the projected order, so dnd-kit's sortable plugins stay off: the optimistic DOM
  // reorder janks when rows move between nested subtree containers, and the tree moves keyboard
  // drags itself (one position per arrow key, see Tree's onDragMove).
  plugins: SORTABLE_PLUGINS,
} as const

// Sanity UI draws the card's border with this custom property: it only shows on the lifted row
const HIDDEN_BORDER_STYLE: React.CSSProperties = Object.fromEntries([
  ['--card-border-color', 'transparent'],
])

// The dragged row itself is lifted (dnd-kit's Feedback plugin moves it with the pointer), with the
// border and shadow of the Studio's lifted array item
// (sanity/src/core/form/inputs/arrays/layouts/RowLayout.tsx, `.moving &`)
const LIFTED_STYLE: React.CSSProperties = Object.fromEntries([
  ['--card-border-color', 'var(--card-shadow-umbra-color)'],
  [
    'boxShadow',
    [
      '0 0 0 0',
      '0 8px 17px 2px var(--card-shadow-umbra-color)',
      '0 3px 14px 2px var(--card-shadow-penumbra-color)',
      '0 5px 5px -3px var(--card-shadow-ambient-color)',
    ].join(', '),
  ],
])

// The native item pads itself (4px around its card, then 1px border and 4px padding): pull it in so
// the preview sits where it always has, next to the handle and chevron
const ITEM_STYLE: React.CSSProperties = {minWidth: 0, marginLeft: -8}

// As wide as the "Add nested item" button
const ADD_CHILD_SLOT_STYLE: React.CSSProperties = {flex: 'none', width: 25}

function TreeItemComponent({
  item,
  member,
  index,
  disabled = false,
  hasChildren,
  onRemove,
  onInsert,
  onCollapse,
  onItemOpen,
  disabledActions,
  callbacks,
  sortable = true,
  canHover = true,
  onAddChild,
  addChildSlot = false,
  childTypes = NO_TYPES,
}: Props) {
  const {id, collapsed, depth, parentId} = item
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  // Hover is local to the row, so moving the mouse doesn't re-render the whole tree
  const [isHovering, setHovering] = useState(false)
  // Keyboard users reach "Add nested item" by tabbing into the row; touch screens can't hover
  const [hasFocus, setHasFocus] = useState(false)
  const readOnly = member.item.readOnly
  const {ref, handleRef, isDragging} = useSortable({
    ...config,
    id,
    index,
    disabled: disabled || !sortable,
    data: {
      depth,
      parentId,
    },
  })

  // Memoized, so the native item only re-renders when its member does
  // Mounts the native item afresh after Duplicate or Add item before/after. Its closed item menu
  // stays mounted (hidden), and would take focus back from the new item's dialog when the row
  // re-renders; the Studio's own list mounts its rows again after an insert.
  const [itemKey, setItemKey] = useState(0)
  const rowActions = useMemo<TreeRowActions>(
    () => ({
      isRoot: parentId === null,
      disabledActions,
      onOpen: () => onItemOpen(id),
      onRemove: () => onRemove(id),
      onInsert: (event) => {
        setItemKey((key) => key + 1)
        onInsert(id, event)
      },
    }),
    [disabledActions, id, onInsert, onItemOpen, onRemove, parentId],
  )

  const isDisabled = disabled || readOnly
  const showActions = !isDisabled && (isHovering || hasFocus || !canHover)

  return (
    // Without a drag handle (`options.sortable: false`) dnd-kit would make the row itself a
    // disabled draggable `role="button"`, around the item's own buttons: leave it out
    <div ref={sortable ? ref : undefined}>
      <Card
        radius={2}
        border
        style={isDragging ? LIFTED_STYLE : HIDDEN_BORDER_STYLE}
        shadow={0}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        // Only keyboard focus: a mouse click also focuses the button it lands on
        onFocus={(event) => setHasFocus(event.target.matches(':focus-visible'))}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false)
        }}
      >
        <Flex gap={1} style={{width: '100%'}} align="center" paddingLeft={1}>
          {sortable && (
            <Tooltip
              content={
                <Text muted size={1}>
                  {t('drag-to-reorder')}
                </Text>
              }
              animate
              // No tooltip mid-drag: it would follow the moving handle on every frame
              disabled={isDragging}
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button
                aria-label={t('drag-to-reorder')}
                disabled={isDisabled}
                ref={handleRef}
                paddingX={2}
                mode="bleed"
                icon={DragHandleIcon}
                // Pressed while its row is dragged, like the Studio's drag handle
                selected={isDragging}
                style={{pointerEvents: isDisabled ? 'none' : 'auto', cursor: 'all-scroll'}}
              />
            </Tooltip>
          )}
          {hasChildren && onCollapse && (
            <Tooltip
              content={
                <Text muted size={1}>
                  {collapsed ? t('expand') : t('collapse')}
                </Text>
              }
              animate
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button
                aria-expanded={!collapsed}
                aria-label={collapsed ? t('expand') : t('collapse')}
                disabled={disabled}
                mode="bleed"
                paddingX={2}
                icon={collapsed ? ChevronRightIcon : ChevronDownIcon}
                onClick={() => onCollapse(id)}
              />
            </Tooltip>
          )}
          <Box flex={1} style={ITEM_STYLE}>
            <TreeRowProvider value={rowActions}>
              <NativeItem key={itemKey} member={member} callbacks={callbacks} />
            </TreeRowProvider>
          </Box>
          {addChildSlot && (
            <Box style={ADD_CHILD_SLOT_STYLE}>
              {onAddChild && showActions && (
                <AddChildButton id={id} onAdd={onAddChild} types={childTypes} />
              )}
            </Box>
          )}
        </Flex>
      </Card>
    </div>
  )
}

export const TreeItem = memo(TreeItemComponent, (previous, next) => {
  return (
    previous.item.id === next.item.id &&
    previous.item.parentId === next.item.parentId &&
    previous.item.depth === next.item.depth &&
    previous.item.collapsed === next.item.collapsed &&
    previous.member === next.member &&
    previous.index === next.index &&
    previous.disabled === next.disabled &&
    previous.hasChildren === next.hasChildren &&
    previous.onRemove === next.onRemove &&
    previous.onInsert === next.onInsert &&
    previous.onCollapse === next.onCollapse &&
    previous.onItemOpen === next.onItemOpen &&
    previous.disabledActions === next.disabledActions &&
    previous.callbacks === next.callbacks &&
    previous.sortable === next.sortable &&
    previous.canHover === next.canHover &&
    previous.onAddChild === next.onAddChild &&
    previous.addChildSlot === next.addChildSlot &&
    previous.childTypes === next.childTypes
  )
})
