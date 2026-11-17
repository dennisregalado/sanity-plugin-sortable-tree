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
import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {type ArrayOfObjectsItemMember, type Path, type SchemaType, useTranslation} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import {MemberPreview, type RenderCallbacks, type RowFocus} from './member-preview'
import {type AddableType, AddChildButton} from './new-tree-item'
import type {PatchInput} from './patches'
import {ReferenceValue} from './reference-value'
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
  /** Applies patches from an input shown in the row (relative to the item) */
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
const NO_PATH: Path = []
const REF_PATH: Path = ['_ref']

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
  // References are edited in the row itself, with the Studio's reference search (no dialog)
  const isReference = isReferenceType(member.item.schemaType)
  const referenceId = isReference ? getReferenceId(member.item.value) : undefined
  // "Replace" (or focusing the search of an empty reference) is the row's own state: see RowFocus
  const [referenceFocusPath, setReferenceFocusPath] = useState<Path>(NO_PATH)
  const handleReferenceFocus = useCallback((path: Path) => {
    // Focusing `_ref` keeps the search open; anything else (picked, Escape, clicked outside) ends it
    setReferenceFocusPath(path.length === 1 && path[0] === '_ref' ? REF_PATH : NO_PATH)
  }, [])
  const handleInputChange = useCallback(
    (patches: PatchInput) => onItemPatch?.(id, patches),
    [id, onItemPatch],
  )
  const rowFocus = useMemo<RowFocus>(
    () => ({
      focusPath: referenceFocusPath,
      onPathFocus: handleReferenceFocus,
      onChange: handleInputChange,
    }),
    [handleInputChange, handleReferenceFocus, referenceFocusPath],
  )
  const editingReference = isReference && (!referenceId || referenceFocusPath.length > 0)
  const referenceSearchRef = useRef<HTMLDivElement>(null)
  const focusSearchRef = useRef(false)
  // References open their search in the row; other items open in the Studio's dialog
  const handleOpen = useCallback(() => {
    if (!isReference) {
      onItemOpen?.(id)
      return
    }
    focusSearchRef.current = true
    setReferenceFocusPath(REF_PATH)
  }, [id, isReference, onItemOpen])
  // The Studio's reference input only focuses itself when `_ref` gets focus after it mounts: focus
  // its search once it's there. For a picked reference, wait until it shows the document's title
  // (it fills that in once loaded, over anything typed before), then select it so typing replaces
  // it, as the "Replace" action says.
  const autoFocusedRef = useRef(false)
  const waitForTitle = referenceId !== undefined
  useEffect(() => {
    const autoFocus = autoFocusSearch && !autoFocusedRef.current
    if (!editingReference || !(focusSearchRef.current || autoFocus)) return undefined
    focusSearchRef.current = false
    autoFocusedRef.current = autoFocusedRef.current || autoFocusSearch
    let frame = 0
    let tries = 0
    const focusInput = () => {
      const input = referenceSearchRef.current?.querySelector<HTMLInputElement>('input')
      if (input && (input.value || !waitForTitle || tries > 60)) {
        input.focus()
        input.select()
      } else if (tries++ < 120) {
        frame = requestAnimationFrame(focusInput)
      }
    }
    focusInput()
    return () => cancelAnimationFrame(frame)
  }, [autoFocusSearch, editingReference, referenceFocusPath, waitForTitle])

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
          {editingReference && !isDisabled ? (
            // Like the Studio's array item for a reference: its title above the reference search
            <Stack ref={referenceSearchRef} flex={1} gap={3} padding={2} style={{minWidth: 0}}>
              <Text size={1} weight="medium">
                {member.item.schemaType.title || member.item.schemaType.name}
              </Text>
              <MemberPreview member={member} callbacks={callbacks} rowFocus={rowFocus} />
            </Stack>
          ) : referenceId ? (
            <Box flex={1} paddingX={1} style={{minWidth: 0}}>
              <ReferenceValue
                documentId={referenceId}
                to={getReferenceTargets(member.item.schemaType)}
                path={member.item.path}
                disabled={isDisabled}
                onReplace={handleOpen}
              />
            </Box>
          ) : (
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
                <Box style={{marginLeft: -8, minWidth: 0}}>
                  <MemberPreview member={member} callbacks={callbacks} />
                </Box>
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
          {showActions && !isReference && (
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
