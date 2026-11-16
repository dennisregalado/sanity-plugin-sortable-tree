import {useSortable} from '@dnd-kit/react/sortable'
import type {PluginConstructor} from '@dnd-kit/abstract'
import type React from 'react'
import {ChevronDownIcon} from '@sanity/icons/ChevronDown'
import {ChevronRightIcon} from '@sanity/icons/ChevronRight'
import {DragHandleIcon} from '@sanity/icons/DragHandle'
import {EditIcon} from '@sanity/icons/Edit'
import {TrashIcon} from '@sanity/icons/Trash'
import {FlattenedItem} from './types'
import {Box, Button, Card, Flex, Text} from '@sanity/ui'
import {Tooltip} from '@sanity/ui/tooltip'
import {memo, useMemo} from 'react'

export interface Props {
  item: FlattenedItem
  member?: any
  index: number
  disabled?: boolean
  onRemove?(id: string): void
  onCollapse?(id: string): void
  hasChildren?: boolean
  onItemOpen?(id: string): void
  isHovering?: boolean
  onHoverChange?(id: string | null): void
  children?: React.ReactNode
}

const config = {
  alignment: {
    x: 'start',
    y: 'center',
  },
  transition: {
    idle: true,
  },
  // React owns the projected order. Disabling the built-in optimistic DOM
  // reorder avoids jank when rows move between nested subtree containers.
  plugins: [] as PluginConstructor[],
} as const

function TreeItemComponent({
  item,
  member,
  index,
  disabled = false,
  hasChildren,
  isHovering = false,
  onRemove,
  onCollapse,
  onItemOpen,
  onHoverChange,
  children,
}: Props) {
  const {id, collapsed, depth, parentId} = item
  const readOnly = useMemo(() => member?.item?.readOnly, [member])
  const {ref, handleRef, isDragSource, isDragging} = useSortable({
    ...config,
    id,
    index,
    disabled,
    data: {
      depth,
      parentId,
    },
  })

  const isDisabled = disabled || readOnly

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
        tone={isDragging ? 'suggest' : 'default'}
        style={
          {
            ...(!isHovering ? {'--card-border-color': 'transparent'} : null),
          } as React.CSSProperties
        }
        shadow={!isHovering && isDragging ? 5 : 0}
        onMouseEnter={() => onHoverChange?.(id)}
        onMouseLeave={() => onHoverChange?.(null)}
      >
        <Flex gap={1} style={{width: '100%'}} align="center">
          <Tooltip
            content={
              <Text muted size={1}>
                Drag to reorder
              </Text>
            }
            animate
            fallbackPlacements={['right', 'left']}
            placement="top"
            portal
          >
            <Button
              disabled={isDisabled}
              ref={handleRef}
              paddingX={2}
              mode="bleed"
              icon={DragHandleIcon}
              style={{pointerEvents: isDisabled ? 'none' : 'auto', cursor: 'all-scroll'}}
            />
          </Tooltip>
          {hasChildren && onCollapse && (
            <Tooltip
              content={
                <Text muted size={1}>
                  {collapsed ? 'Expand' : 'Collapse'}
                </Text>
              }
              animate
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button
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
              <Box style={{marginLeft: -8}}>{children}</Box>
            </Flex>
          </Button>
          {isHovering && !isDisabled && (
            <Tooltip
              content={
                <Text muted size={1}>
                  Edit
                </Text>
              }
              animate
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button onClick={() => onItemOpen?.(id)} icon={EditIcon} mode="bleed" padding={2} />
            </Tooltip>
          )}
          {onRemove && isHovering && !isDisabled && (
            <Tooltip
              content={
                <Text muted size={1}>
                  Remove
                </Text>
              }
              animate
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button
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
    previous.isHovering === next.isHovering &&
    previous.onRemove === next.onRemove &&
    previous.onCollapse === next.onCollapse &&
    previous.onItemOpen === next.onItemOpen &&
    previous.onHoverChange === next.onHoverChange
  )
})
