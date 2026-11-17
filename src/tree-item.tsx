import type {PluginConstructor} from '@dnd-kit/abstract'
import {useSortable} from '@dnd-kit/react/sortable'
import {ChevronDownIcon} from '@sanity/icons/ChevronDown'
import {ChevronRightIcon} from '@sanity/icons/ChevronRight'
import {DragHandleIcon} from '@sanity/icons/DragHandle'
import {EditIcon} from '@sanity/icons/Edit'
import {ErrorOutlineIcon} from '@sanity/icons/ErrorOutline'
import {TrashIcon} from '@sanity/icons/Trash'
import {WarningOutlineIcon} from '@sanity/icons/WarningOutline'
import {Box, Button, Card, Flex, Stack, Text} from '@sanity/ui'
import {Tooltip} from '@sanity/ui/tooltip'
import type React from 'react'
import {memo, useMemo, useState} from 'react'
import {type ArrayOfObjectsItemMember, useTranslation} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import {MemberPreview, type RenderCallbacks} from './member-preview'
import {type AddableType, AddChildButton} from './new-tree-item'
import {FlattenedItem} from './types'
import {collectValidation} from './validation'

export interface Props {
  item: Pick<FlattenedItem, 'id' | 'collapsed' | 'depth' | 'parentId'>
  member: ArrayOfObjectsItemMember
  /** Render callbacks for the item's preview */
  callbacks: RenderCallbacks
  index: number
  disabled?: boolean
  onRemove?: (id: string) => void
  onCollapse?: (id: string) => void
  hasChildren?: boolean
  onItemOpen?: (id: string) => void
  /** Whether the pointer can hover (false on touch screens): measured once for the whole tree */
  canHover?: boolean
  /** False hides the drag handle (`options.sortable: false`) */
  sortable?: boolean
  /** Adds a nested item (with the type picked from `childTypes` when there are several) */
  onAddChild?: (id: string, typeName?: string) => void
  childTypes?: AddableType[]
}

const SORTABLE_PLUGINS: PluginConstructor[] = []
const NO_TYPES: AddableType[] = []

const config = {
  alignment: {
    x: 'start',
    y: 'center',
  },
  transition: {
    idle: true,
  },
  // React owns the projected order, so dnd-kit's sortable plugins stay off: the optimistic DOM
  // reorder janks when rows move between nested subtree containers, and the tree moves keyboard
  // drags itself (one position per arrow key, see Tree's onDragMove).
  plugins: SORTABLE_PLUGINS,
} as const

// Sanity UI draws the card's border with this custom property: hide it unless the row is hovered
const HIDDEN_BORDER_STYLE: React.CSSProperties = Object.fromEntries([
  ['--card-border-color', 'transparent'],
])

function TreeItemComponent({
  item,
  member,
  index,
  disabled = false,
  hasChildren,
  onRemove,
  onCollapse,
  onItemOpen,
  callbacks,
  sortable = true,
  canHover = true,
  onAddChild,
  childTypes = NO_TYPES,
}: Props) {
  const {id, collapsed, depth, parentId} = item
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  // Hover is local to the row, so moving the mouse doesn't re-render the whole tree
  const [isHovering, setHovering] = useState(false)
  // Keyboard users reach Edit and Remove by tabbing into the row; touch screens can't hover
  const [hasFocus, setHasFocus] = useState(false)
  const readOnly = useMemo(() => member?.item?.readOnly, [member])
  const {ref, handleRef, isDragSource, isDragging} = useSortable({
    ...config,
    id,
    index,
    disabled: disabled || !sortable,
    data: {
      depth,
      parentId,
    },
  })

  const isDisabled = disabled || readOnly
  const showActions = !isDisabled && (isHovering || hasFocus || !canHover)
  // Errors and warnings in the item's fields; a collapsed item also shows its hidden children's
  const validation = useMemo(() => collectValidation(member.item, collapsed), [member, collapsed])
  const errors = validation.filter((marker) => marker.level === 'error')
  const warnings = validation.filter((marker) => marker.level === 'warning')
  const shownMarkers = errors.length ? errors : warnings

  return (
    <div
      ref={ref}
      style={
        isDragging
          ? {
              zIndex: 1000,
              position: 'relative',
            }
          : undefined
      }
      aria-hidden={isDragSource}
    >
      <Card
        padding={1}
        radius={2}
        border
        // Like the Studio's array items: invalid rows take the critical (or caution) tone
        tone={
          isDragging
            ? 'suggest'
            : errors.length
              ? 'critical'
              : warnings.length
                ? 'caution'
                : 'default'
        }
        style={isHovering ? undefined : HIDDEN_BORDER_STYLE}
        shadow={!isHovering && isDragging ? 5 : 0}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        // Only keyboard focus: a mouse click also focuses the button it lands on
        onFocus={(event) => setHasFocus(event.target.matches(':focus-visible'))}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false)
        }}
      >
        <Flex gap={1} style={{width: '100%'}} align="center">
          {sortable && (
            <Tooltip
              content={
                <Text muted size={1}>
                  {t('drag-to-reorder')}
                </Text>
              }
              animate
              // No tooltip mid-drag: it would follow the moving handle on every frame
              disabled={isDragging || isDragSource}
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
          <Button
            disabled={isDisabled}
            style={{minHeight: 32}}
            width="fill"
            mode="bleed"
            padding={1}
            paddingX={2}
            onClick={() => onItemOpen?.(id)}
          >
            <Flex align="center" justify="space-between" style={{width: '100%'}}>
              <Box style={{marginLeft: -8}}>
                <MemberPreview member={member} callbacks={callbacks} />
              </Box>
            </Flex>
          </Button>
          {shownMarkers.length > 0 && (
            <Tooltip
              content={
                <Stack gap={3} padding={1}>
                  {shownMarkers.slice(0, 5).map((marker) => (
                    <Flex
                      key={`${marker.message}-${JSON.stringify(marker.path)}`}
                      align="center"
                      gap={2}
                    >
                      <Card tone={marker.level === 'error' ? 'critical' : 'caution'}>
                        <Text size={1}>
                          {marker.level === 'error' ? <ErrorOutlineIcon /> : <WarningOutlineIcon />}
                        </Text>
                      </Card>
                      <Text size={1}>{marker.message}</Text>
                    </Flex>
                  ))}
                </Stack>
              }
              animate
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button
                aria-label={
                  errors.length
                    ? t('validation.errors', {count: errors.length})
                    : t('validation.warnings', {count: warnings.length})
                }
                icon={errors.length ? ErrorOutlineIcon : WarningOutlineIcon}
                mode="bleed"
                padding={2}
                tone={errors.length ? 'critical' : 'caution'}
                onClick={() => onItemOpen?.(id)}
              />
            </Tooltip>
          )}
          {onAddChild && showActions && (
            <AddChildButton id={id} onAdd={onAddChild} types={childTypes} />
          )}
          {showActions && (
            <Tooltip
              content={
                <Text muted size={1}>
                  {t('edit')}
                </Text>
              }
              animate
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button
                aria-label={t('edit')}
                onClick={() => onItemOpen?.(id)}
                icon={EditIcon}
                mode="bleed"
                padding={2}
              />
            </Tooltip>
          )}
          {onRemove && showActions && (
            <Tooltip
              content={
                <Text muted size={1}>
                  {t('remove')}
                </Text>
              }
              animate
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button
                aria-label={t('remove')}
                mode="bleed"
                padding={2}
                icon={TrashIcon}
                tone="critical"
                onClick={() => onRemove(id)}
              />
            </Tooltip>
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
    previous.onCollapse === next.onCollapse &&
    previous.onItemOpen === next.onItemOpen &&
    previous.callbacks === next.callbacks &&
    previous.sortable === next.sortable &&
    previous.canHover === next.canHover &&
    previous.onAddChild === next.onAddChild &&
    previous.childTypes === next.childTypes
  )
})
