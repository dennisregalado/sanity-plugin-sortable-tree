import {Box, Stack} from '@sanity/ui'
import {useCallback, useMemo} from 'react'
import {type ArrayOfObjectsInputProps, type FormPatch, type Path} from 'sanity'

import {Tree} from './tree'
import type {Item} from './types'
import {isReferenceType, isTreeItem} from './utils'

const EMPTY: Item[] = []

/**
 * The tree input. The plugin uses it for arrays with `options.tree`; it can also be set directly as
 * a field's `components.input`.
 *
 * @public
 */
export function SortableTreeInput(props: ArrayOfObjectsInputProps): React.JSX.Element {
  const {members, onChange, onItemOpen, onPathFocus, path, schemaType} = props

  const maxDepth = schemaType.options?.maxDepth ?? 3

  const items = useMemo(
    () => (Array.isArray(props.value) ? props.value.filter(isTreeItem) : EMPTY),
    [props.value],
  )

  // The hidden copy of the default input only hosts the items' edit dialogs. References have no
  // dialog (the tree row shows their reference search), and a second, hidden reference search
  // would fight the row's one over focus and clear the reference on "outside" clicks.
  const hiddenProps = useMemo(() => {
    const dialogMembers = members.filter(
      (member) => !(member.kind === 'item' && isReferenceType(member.item.schemaType)),
    )
    return dialogMembers.length === members.length ? props : {...props, members: dialogMembers}
  }, [members, props])

  const handlePatch = useCallback((patches: FormPatch[]) => onChange(patches), [onChange])

  // `onItemOpen` takes an absolute path, `onPathFocus` a relative one (like the tree's paths)
  const handleItemOpen = useCallback(
    (itemPath: Path, focusPath?: Path) => {
      onItemOpen([...path, ...itemPath])
      if (focusPath) onPathFocus(focusPath)
    },
    [onItemOpen, onPathFocus, path],
  )

  return (
    <Stack gap={2} style={{position: 'relative'}}>
      <Tree
        members={members}
        props={props}
        items={items}
        maxDepth={maxDepth}
        readOnly={props.readOnly}
        onPatch={handlePatch}
        onItemOpen={handleItemOpen}
      />
      <Box
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {props.renderDefault(hiddenProps)}
      </Box>
    </Stack>
  )
}
