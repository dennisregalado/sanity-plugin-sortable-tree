import {AddIcon} from '@sanity/icons/Add'
import {Button} from '@sanity/ui'
import {memo, useCallback} from 'react'

interface Props {
  addItem(parentId: string | null): void
  disabled?: boolean
  parentId?: string | null
}

function NewTreeItemComponent({addItem, disabled = false, parentId = null}: Props) {
  const handleClick = useCallback(() => {
    addItem(parentId)
  }, [addItem, parentId])

  return (
    <Button
      disabled={disabled}
      mode="ghost"
      icon={AddIcon}
      text="Add item"
      onClick={handleClick}
      width="fill"
      padding={2}
    />
  )
}

export const NewTreeItem = memo(NewTreeItemComponent)
