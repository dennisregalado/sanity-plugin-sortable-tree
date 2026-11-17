import {type InputProps, isArrayOfObjectsInputProps} from 'sanity'

import {SortableTreeInput} from './input'
import {TreeErrorBoundary} from './tree-error-boundary'

/**
 * The plugin's `form.components.input`: renders the tree for arrays of objects with
 * `options.tree` (including named array types) and the default input for everything else.
 */
export function FormInput(props: InputProps): React.JSX.Element {
  if (isArrayOfObjectsInputProps(props) && props.schemaType.options?.tree) {
    // If the tree ever throws, fall back to the Studio's default array input
    return (
      <TreeErrorBoundary fallback={() => props.renderDefault(props)}>
        <SortableTreeInput {...props} />
      </TreeErrorBoundary>
    )
  }

  return props.renderDefault(props)
}
