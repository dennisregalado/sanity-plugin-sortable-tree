import type {FormNodeValidation} from 'sanity'

import {CHILDREN_FIELD} from './patches'

/** The parts of a form node (object, array or field) that carry validation */
interface ValidatedNode {
  validation?: FormNodeValidation[]
  members?: unknown[]
}

function isNode(value: unknown): value is ValidatedNode {
  return typeof value === 'object' && value !== null
}

function memberNodes(member: unknown): unknown[] {
  if (!isNode(member) || !('kind' in member)) return []

  switch (member.kind) {
    case 'field':
      return 'field' in member ? [member.field] : []
    case 'item':
      return 'item' in member ? [member.item] : []
    case 'fieldSet':
      return 'fieldSet' in member && isNode(member.fieldSet)
        ? (member.fieldSet.members ?? []).flatMap(memberNodes)
        : []
    default:
      return []
  }
}

/**
 * Validation markers of a tree item and everything inside it, collected from the form state (the
 * same markers the Studio's own array items show). The nested items in `children` are left out
 * unless `includeChildren` is set: they have rows of their own.
 */
export function collectValidation(
  node: unknown,
  includeChildren: boolean,
  isRoot = true,
): FormNodeValidation[] {
  if (!isNode(node)) return []

  const markers = [...(node.validation ?? [])]

  for (const member of node.members ?? []) {
    if (
      isRoot &&
      !includeChildren &&
      isNode(member) &&
      'name' in member &&
      member.name === CHILDREN_FIELD
    ) {
      continue
    }
    for (const child of memberNodes(member)) {
      markers.push(...collectValidation(child, includeChildren, false))
    }
  }

  return markers
}
