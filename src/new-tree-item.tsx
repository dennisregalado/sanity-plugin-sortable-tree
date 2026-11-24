import {AddIcon} from '@sanity/icons/Add'
import {Box, Button, Text} from '@sanity/ui'
import {Menu, MenuButton, MenuItem} from '@sanity/ui/menu'
import {Tooltip} from '@sanity/ui/tooltip'
import {memo, useCallback, useId} from 'react'
import {useTranslation} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import {Ruled} from './items-toggle'
import type {AddableType} from './schema-types'

interface Props {
  addItem: (parentId: string | null, typeName?: string) => void
  disabled?: boolean
  parentId?: string | null
  /** The item types the list accepts: with more than one, the button opens a menu */
  types?: AddableType[]
  /**
   * A nested list's button, first in the list: small, quiet and centered between two rules, like
   * the "Show all N items" toggle. Otherwise the tree's own button below it, like the Studio's
   * array button.
   */
  inline?: boolean
}

const NO_TYPES: AddableType[] = []

function NewTreeItemComponent({
  addItem,
  disabled = false,
  parentId = null,
  types = NO_TYPES,
  inline = false,
}: Props) {
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const menuId = useId()
  const handleClick = useCallback(() => {
    addItem(parentId)
  }, [addItem, parentId])

  const onClick = types.length > 1 ? undefined : handleClick
  const button = inline ? (
    // The toggle's button (see ItemsToggle)
    <Button
      disabled={disabled}
      fontSize={1}
      icon={AddIcon}
      mode="bleed"
      padding={2}
      text={t('add-item')}
      onClick={onClick}
    />
  ) : (
    <Button
      disabled={disabled}
      mode="ghost"
      icon={AddIcon}
      text={t('add-item')}
      onClick={onClick}
      width="fill"
      // The size of the Studio's own array "Add item" button
      padding={3}
    />
  )

  if (types.length <= 1) return inline ? <Ruled>{button}</Ruled> : button

  const menu = (
    <MenuButton
      id={menuId}
      button={button}
      menu={
        <Menu>
          {types.map((type) => (
            <MenuItem
              key={type.name}
              icon={type.icon}
              text={type.title}
              onClick={() => addItem(parentId, type.name)}
            />
          ))}
        </Menu>
      }
      // As wide as its items and centered under the button, like the row's "Add nested item" menu
      popover={{portal: true, placement: 'bottom', fallbackPlacements: ['top']}}
    />
  )

  return inline ? <Ruled>{menu}</Ruled> : menu
}

export const NewTreeItem = memo(NewTreeItemComponent)

interface AddChildButtonProps {
  id: string
  onAdd: (id: string, typeName?: string) => void
  types: AddableType[]
}

/** Row action that adds a nested item, with a type menu when several types are allowed */
export function AddChildButton({id, onAdd, types}: AddChildButtonProps): React.JSX.Element {
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const menuId = useId()

  const button = (
    <Button
      aria-label={t('add-child')}
      icon={AddIcon}
      mode="bleed"
      padding={2}
      onClick={types.length > 1 ? undefined : () => onAdd(id)}
    />
  )

  return (
    <Tooltip
      content={
        <Text muted size={1}>
          {t('add-item')}
        </Text>
      }
      animate
      fallbackPlacements={['right', 'left']}
      placement="top"
      portal
    >
      {types.length > 1 ? (
        // The menu button doesn't pass the tooltip's ref and events on to its button: this does
        <Box display="inline-block">
          <MenuButton
            id={menuId}
            button={button}
            menu={
              <Menu>
                {types.map((type) => (
                  <MenuItem
                    key={type.name}
                    icon={type.icon}
                    text={type.title}
                    onClick={() => onAdd(id, type.name)}
                  />
                ))}
              </Menu>
            }
            popover={{portal: true, placement: 'bottom-end'}}
          />
        </Box>
      ) : (
        button
      )}
    </Tooltip>
  )
}
