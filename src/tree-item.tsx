import type {PluginConstructor} from '@dnd-kit/abstract'
import {useSortable} from '@dnd-kit/react/sortable'
import {ChevronDownIcon} from '@sanity/icons/ChevronDown'
import {ChevronRightIcon} from '@sanity/icons/ChevronRight'
import {DragHandleIcon} from '@sanity/icons/DragHandle'
import {EditIcon} from '@sanity/icons/Edit'
import {TrashIcon} from '@sanity/icons/Trash'
import {Box, Button, Card, Flex, Text} from '@sanity/ui'
import {Tooltip} from '@sanity/ui/tooltip'
import type React from 'react'
import {memo, useMemo, useState} from 'react'
import {type ArrayOfObjectsItemMember, useTranslation} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import {MemberPreview, type RenderCallbacks} from './member-preview'
import {FlattenedItem} from './types'

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
}: Props) {
  const {id, collapsed, depth, parentId} = item
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  // Hover is local to the row, so moving the mouse doesn't re-render the whole tree
  const [isHovering, setHovering] = useState(false)
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
        style={isHovering ? undefined : HIDDEN_BORDER_STYLE}
        shadow={!isHovering && isDragging ? 5 : 0}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <Flex gap={1} style={{width: '100%'}} align="center">
          <Tooltip
            content={
              <Text muted size={1}>
                {t('drag-to-reorder')}
              </Text>
            }
            animate
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
          {isHovering && !isDisabled && (
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
          {onRemove && isHovering && !isDisabled && (
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
    previous.callbacks === next.callbacks
  )
})
