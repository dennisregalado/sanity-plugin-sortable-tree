import {memo, useMemo} from 'react'
import {
  ArrayOfObjectsItem,
  type ArrayOfObjectsItemMember,
  type ItemProps,
  type ObjectItemProps,
  type PreviewProps,
  type RenderAnnotationCallback,
  type RenderArrayOfObjectsItemCallback,
  type RenderBlockCallback,
  type RenderFieldCallback,
  type RenderInputCallback,
  type RenderPreviewCallback,
  type RenderPreviewCallbackProps,
  useTranslation,
} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'

/** The form render callbacks an array item needs */
export interface RenderCallbacks {
  renderAnnotation?: RenderAnnotationCallback
  renderBlock?: RenderBlockCallback
  renderField: RenderFieldCallback
  renderInlineBlock?: RenderBlockCallback
  renderInput: RenderInputCallback
  renderItem: RenderArrayOfObjectsItemCallback
  renderPreview: RenderPreviewCallback
}

/** Renders only the item's preview (the tree row provides the rest) */
function TreeItemInput(props: ItemProps) {
  const {inputProps} = props as ObjectItemProps
  return inputProps.renderPreview(inputProps as unknown as RenderPreviewCallbackProps)
}

/** The Studio's own preview of the item, in the compact layout */
function TreeItemPreview(props: PreviewProps) {
  const {t} = useTranslation(sortableTreeLocaleNamespace)

  return props.renderDefault({
    ...props,
    layout: 'compact',
    title: props.title || t('untitled'),
    subtitle: undefined,
    description: undefined,
  })
}

interface MemberPreviewProps {
  member: ArrayOfObjectsItemMember
  callbacks: RenderCallbacks
}

/** An array member rendered through the Studio's item pipeline, showing just its preview */
export const MemberPreview = memo(function MemberPreview({member, callbacks}: MemberPreviewProps) {
  const previewMember = useMemo(
    () => ({
      ...member,
      item: {
        ...member.item,
        schemaType: {
          ...member.item.schemaType,
          components: {
            ...member.item.schemaType.components,
            item: TreeItemInput,
            preview: TreeItemPreview,
          },
        },
      },
    }),
    [member],
  )

  return <ArrayOfObjectsItem member={previewMember} {...callbacks} />
})
