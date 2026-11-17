import {ChevronDownIcon} from '@sanity/icons/ChevronDown'
import {ChevronUpIcon} from '@sanity/icons/ChevronUp'
import {Box, Button, Flex} from '@sanity/ui'
import {memo} from 'react'
import {useTranslation} from 'sanity'

const RULE_STYLE: React.CSSProperties = {
  flex: 1,
  height: 1,
  backgroundColor: 'var(--card-border-color)',
}

interface Props {
  /** The list's key (see `listKey`) */
  list: string
  expanded: boolean
  /** How many items the list has */
  count: number
  onToggle: (list: string) => void
}

/**
 * "Show all N items" / "Show fewer items" between two rules, under a list that's longer than its
 * limit: the Studio's own array toggle (`ArrayItemsToggle`), with its own strings
 */
function ItemsToggleComponent({list, expanded, count, onToggle}: Props) {
  const {t} = useTranslation()

  return (
    <Flex align="center" gap={2} data-testid="array-items-toggle">
      <Box style={RULE_STYLE} />
      <Button
        aria-expanded={expanded}
        fontSize={1}
        iconRight={expanded ? ChevronUpIcon : ChevronDownIcon}
        mode="bleed"
        padding={2}
        text={
          expanded
            ? t('inputs.array.action.show-fewer-items')
            : t('inputs.array.action.show-all-items', {count})
        }
        onClick={() => onToggle(list)}
      />
      <Box style={RULE_STYLE} />
    </Flex>
  )
}

export const ItemsToggle = memo(ItemsToggleComponent)
