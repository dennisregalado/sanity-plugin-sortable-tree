import {useEffect} from 'react'
import {ArrayOfObjectsInputProps, ObjectItem} from 'sanity'
import {Tree} from './tree'
import {set} from 'sanity'
import {Box, Stack} from '@sanity/ui'
import type {Item as TreeItemValue} from './types'
import {ensureUniqueSiblingKeys} from './utils'

export function SortableTreeInput<Item extends ObjectItem>(props: ArrayOfObjectsInputProps<Item>) {
  const {members, onChange, schemaType} = props

  const maxDepth = schemaType.options?.maxDepth ?? 3

  const items = (props.value || []) as unknown as TreeItemValue[]

  useEffect(() => {
    // Never write to a document the user can't edit (read-only fields, published perspective,
    // releases that aren't selected, missing permissions).
    if (props.readOnly) return

    const result = ensureUniqueSiblingKeys(items)

    if (result.changed) {
      onChange(set(result.items))
    }
  }, [items, onChange, props.readOnly])

  return (
    <Stack gap={2} style={{position: 'relative'}}>
      <Tree
        members={members}
        props={props}
        items={items}
        maxDepth={maxDepth}
        readOnly={props.readOnly}
        onChange={(newItems) => {
          onChange(set(newItems))
        }}
        onItemOpen={(path) => {
          props.onPathFocus(path)
        }}
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
        {props.renderDefault(props as any)}
      </Box>
    </Stack>
  )
}
