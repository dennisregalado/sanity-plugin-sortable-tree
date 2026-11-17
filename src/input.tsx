import {useCallback, useMemo} from 'react'
import {type ArrayOfObjectsInputProps, type FormPatch, type Path} from 'sanity'

import {Tree} from './tree'
import type {Item} from './types'
import {isTreeItem} from './utils'

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
    <Tree
      members={members}
      props={props}
      items={items}
      maxDepth={maxDepth}
      readOnly={props.readOnly}
      onPatch={handlePatch}
      onItemOpen={handleItemOpen}
    />
  )
}
