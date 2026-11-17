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
import {memo, useCallback, useMemo, useState} from 'react'
import {
  type ArrayOfObjectsItemMember,
  type FormPatch,
  type SchemaType,
  set,
  unset,
  useTranslation,
} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import {MemberPreview, type RenderCallbacks} from './member-preview'
import {type AddableType, AddChildButton} from './new-tree-item'
import type {PatchInput} from './patches'
import {ReferenceSearch, type ReferenceTarget, useReferenceAvailable} from './reference-search'
import {FlattenedItem} from './types'
import {isReferenceType} from './utils'
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
  /** Focus the reference search once it shows (for a reference that was just added) */
  autoFocusSearch?: boolean
  /** Applies patches from the row's reference search (relative to the item) */
  onItemPatch?: (id: string, patches: PatchInput) => void
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
const NO_TARGETS: SchemaType[] = []

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

// Sanity UI draws the card's border with this custom property: hide it unless the row is hovered
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

function TreeItemComponent({
  item,
  member,
  index,
  disabled = false,
  hasChildren,
  onRemove,
  onCollapse,
  onItemOpen,
  onItemPatch,
  autoFocusSearch = false,
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

  const isDisabled = disabled || readOnly
  const showActions = !isDisabled && (isHovering || hasFocus || !canHover)
  // Errors and warnings in the item's fields; a collapsed item also shows its hidden children's
  const validation = useMemo(() => collectValidation(member.item, collapsed), [member, collapsed])
  const errors = validation.filter((marker) => marker.level === 'error')
  const warnings = validation.filter((marker) => marker.level === 'warning')
  const shownMarkers = errors.length ? errors : warnings
  // References are edited in the row itself, with the reference search (no dialog)
  const isReference = isReferenceType(member.item.schemaType)
  const referenceId = isReference ? getReferenceId(member.item.value) : undefined
  const referenceTargets = useMemo(
    () => (isReference ? getReferenceTargets(member.item.schemaType) : NO_TARGETS),
    [isReference, member.item.schemaType],
  )
  const referenceAvailable = useReferenceAvailable(referenceId, referenceTargets)
  // Replacing a picked reference: the row shows the search until one is picked or it's left
  const [replacing, setReplacing] = useState(false)
  const searching = isReference && (!referenceId || replacing)
  // Leaving the search of a reference that was just added, without picking, removes it again (like
  // the Studio's array input does with an empty new item)
  // The search unmounts with focus in it, without a blur event for the row: reset its focus state
  const handleSearchDone = useCallback(() => {
    setReplacing(false)
    setHasFocus(false)
    if (!referenceId && autoFocusSearch) onRemove?.(id)
  }, [autoFocusSearch, id, onRemove, referenceId])
  const handlePick = useCallback(
    (target: ReferenceTarget) => {
      setReplacing(false)
      setHasFocus(false)
      onItemPatch?.(id, getReferencePatches(target, member.item.schemaType))
    },
    [id, member.item.schemaType, onItemPatch],
  )
  // References open their search in the row; other items open in the Studio's dialog
  const handleOpen = useCallback(() => {
    if (isReference) setReplacing(true)
    else onItemOpen?.(id)
  }, [id, isReference, onItemOpen])

  return (
    <div ref={ref}>
      <Card
        padding={1}
        radius={2}
        border
        // Like the Studio's array items: invalid rows take the critical (or caution) tone
        tone={errors.length ? 'critical' : warnings.length ? 'caution' : 'default'}
        style={isDragging ? LIFTED_STYLE : isHovering ? undefined : HIDDEN_BORDER_STYLE}
        shadow={0}
        // Only the row itself: React also sends these for portals rendered inside it (the reference
        // search's popover), which can close under the pointer without a mouseleave
        onMouseEnter={(event) => {
          if (event.target instanceof Node && event.currentTarget.contains(event.target)) {
            setHovering(true)
          }
        }}
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
          {searching && !isDisabled ? (
            <ReferenceSearch
              to={referenceTargets}
              autoFocus={replacing || autoFocusSearch}
              onPick={handlePick}
              onDone={handleSearchDone}
            />
          ) : (
            // A picked reference looks like any other item: its (referenced document's) preview
            <Button
              disabled={isDisabled}
              style={{minHeight: 32}}
              width="fill"
              mode="bleed"
              padding={1}
              paddingX={2}
              onClick={handleOpen}
            >
              <Flex align="center" justify="space-between" style={{width: '100%'}}>
                {referenceAvailable === false ? (
                  <Box paddingY={2} style={{minWidth: 0}}>
                    <Text muted size={1} textOverflow="ellipsis">
                      {t('reference.unavailable')}
                    </Text>
                  </Box>
                ) : (
                  <Box style={{marginLeft: -8, minWidth: 0}}>
                    <MemberPreview member={member} callbacks={callbacks} />
                  </Box>
                )}
              </Flex>
            </Button>
          )}
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
                onClick={handleOpen}
              />
            </Tooltip>
          )}
          {onAddChild && showActions && (
            <AddChildButton id={id} onAdd={onAddChild} types={childTypes} />
          )}
          {showActions && !searching && (
            <Tooltip
              content={
                <Text muted size={1}>
                  {isReference ? t('reference.replace') : t('edit')}
                </Text>
              }
              animate
              fallbackPlacements={['right', 'left']}
              placement="top"
              portal
            >
              <Button
                aria-label={isReference ? t('reference.replace') : t('edit')}
                onClick={handleOpen}
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

/** The document types a reference schema type can point to (from its own or a base type's `to`) */
function getReferenceTargets(schemaType: unknown): SchemaType[] {
  let type: unknown = schemaType
  for (let depth = 0; typeof type === 'object' && type !== null && depth < 20; depth++) {
    if (hasReferenceTargets(type)) return type.to
    type = 'type' in type ? type.type : undefined
  }
  return []
}

function hasReferenceTargets(type: object): type is {to: SchemaType[]} {
  return 'to' in type && Array.isArray(type.to)
}

/** Sets `_ref`, weak until published when the document only exists as a draft */
function getReferencePatches(target: ReferenceTarget, schemaType: unknown): FormPatch[] {
  const weak =
    typeof schemaType === 'object' && schemaType !== null && 'weak' in schemaType
      ? schemaType.weak === true
      : false
  if (target.draftOnly) {
    return [
      set(true, ['_weak']),
      set({type: target.type, ...(weak ? {weak: true} : {})}, ['_strengthenOnPublish']),
      set(target.id, ['_ref']),
    ]
  }
  return [
    weak ? set(true, ['_weak']) : unset(['_weak']),
    unset(['_strengthenOnPublish']),
    set(target.id, ['_ref']),
  ]
}

function getReferenceId(value: unknown): string | undefined {
  const ref =
    typeof value === 'object' && value !== null && '_ref' in value ? value._ref : undefined
  return typeof ref === 'string' && ref ? ref : undefined
}

export const TreeItem = memo(TreeItemComponent, (previous, next) => {
  return (
    previous.item.id === next.item.id &&
    previous.item.parentId === next.item.parentId &&
    previous.item.depth === next.item.depth &&
    previous.item.collapsed === next.item.collapsed &&
    previous.member === next.member &&
    // Not `index`: rows after a moved row shift index on every projection change, and re-rendering
    // them all is the biggest React cost of a drag in a long tree. dnd-kit only uses a sortable's
    // index for its sortable plugins, its index transition and `move()`, which the tree doesn't use
    // (see `config`), so a stale index is harmless.
    previous.disabled === next.disabled &&
    previous.hasChildren === next.hasChildren &&
    previous.onRemove === next.onRemove &&
    previous.onCollapse === next.onCollapse &&
    previous.onItemOpen === next.onItemOpen &&
    previous.onItemPatch === next.onItemPatch &&
    previous.autoFocusSearch === next.autoFocusSearch &&
    previous.callbacks === next.callbacks &&
    previous.sortable === next.sortable &&
    previous.canHover === next.canHover &&
    previous.onAddChild === next.onAddChild &&
    previous.childTypes === next.childTypes
  )
})
