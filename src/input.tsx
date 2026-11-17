import {Box, Stack} from '@sanity/ui'
import {useCallback} from 'react'
import {
  type ArrayOfObjectsInputProps,
  type FormPatch,
  type InputProps,
  type ObjectItem,
  type Path,
} from 'sanity'

import {Tree} from './tree'
import type {Item as TreeItemValue} from './types'

const EMPTY: TreeItemValue[] = []

export function SortableTreeInput<Item extends ObjectItem>(
  props: ArrayOfObjectsInputProps<Item>,
): React.JSX.Element {
  const {members, onChange, onItemOpen, onPathFocus, path, schemaType} = props

  const maxDepth = schemaType.options?.maxDepth ?? 3

  const items = (Array.isArray(props.value) ? props.value : EMPTY) as unknown as TreeItemValue[]

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
        props={props as unknown as ArrayOfObjectsInputProps<TreeItemValue>}
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
        {props.renderDefault(props as unknown as InputProps)}
      </Box>
    </Stack>
  )
}
