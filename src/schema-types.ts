import type {ComponentType, ReactNode} from 'react'
import type {
  ArrayOfObjectsItemMember,
  ArraySchemaType,
  FieldMember,
  ObjectMember,
  SchemaType,
} from 'sanity'

import {isRecord} from './utils'

/** An item type that can be added to a list */
export interface AddableType {
  name: string
  title: string
  icon?: ComponentType | ReactNode
}

/** Whether a schema type is an array type (has `of`) */
export function isArraySchemaType(schemaType: unknown): schemaType is ArraySchemaType {
  return isRecord(schemaType) && Array.isArray(schemaType.of)
}

/** The types an array accepts (`of`), or none */
export function getArrayMemberTypes(arrayType: unknown): SchemaType[] {
  return isArraySchemaType(arrayType) ? arrayType.of : []
}

/** The array's member type named `typeName`, or its only member type when no name is given */
export function getArrayMemberType(arrayType: unknown, typeName?: string): SchemaType | undefined {
  const memberTypes = getArrayMemberTypes(arrayType)
  if (typeName) return memberTypes.find((memberType) => memberType.name === typeName)
  return memberTypes.length === 1 ? memberTypes[0] : undefined
}

/** Whether an array accepts items of `typeName` (without a type name: whether it has only one type) */
export function canArrayContainType(arrayType: unknown, typeName?: string): boolean {
  const memberTypes = getArrayMemberTypes(arrayType)
  if (!typeName) return memberTypes.length === 1
  return memberTypes.some((memberType) => memberType.name === typeName)
}

const addableTypesCache = new WeakMap<object, AddableType[]>()

/** The item types that can be added to an array, cached so memoized buttons stay stable */
export function getAddableTypes(arrayType: unknown): AddableType[] {
  if (!isArraySchemaType(arrayType)) return []

  let types = addableTypesCache.get(arrayType)
  if (!types) {
    types = arrayType.of.map((memberType) => ({
      name: memberType.name,
      title: memberType.title || memberType.name,
      icon: memberType.icon,
    }))
    addableTypesCache.set(arrayType, types)
  }
  return types
}

/** The type of an item's nested list: its `childrenField` field, if that's an array of objects */
export function getChildrenArrayType(
  objectType: unknown,
  childrenField: string,
): ArraySchemaType | undefined {
  if (!isRecord(objectType) || !Array.isArray(objectType.fields)) return undefined

  const field: unknown = objectType.fields.find(
    (candidate: unknown) => isRecord(candidate) && candidate.name === childrenField,
  )
  const type = isRecord(field) ? field.type : undefined
  return isArraySchemaType(type) ? type : undefined
}

/**
 * Whether a schema type is a reference (or a type based on one). Sanity's own
 * `isReferenceSchemaType` is internal, so this mirrors it: walk the type chain to `reference`.
 */
export function isReferenceType(schemaType: unknown): boolean {
  let type: unknown = schemaType
  for (let depth = 0; isRecord(type) && depth < 20; depth++) {
    if (type.name === 'reference') return true
    type = type.type
  }
  return false
}

/** The document types a reference schema type can point to (from its own or a base type's `to`) */
export function getReferenceTargets(schemaType: unknown): SchemaType[] {
  let type: unknown = schemaType
  for (let depth = 0; isRecord(type) && depth < 20; depth++) {
    if (Array.isArray(type.to)) return type.to.filter(isSchemaType)
    type = type.type
  }
  return []
}

/** Whether `value` looks like a compiled schema type (an object with a `name`) */
function isSchemaType(value: unknown): value is SchemaType {
  return isRecord(value) && typeof value.name === 'string'
}

/** An array member that's an item (not an error for an item the Studio can't show) */
export function isItemMember(member: unknown): member is ArrayOfObjectsItemMember {
  return isRecord(member) && member.kind === 'item'
}

/** The field member of an item's form node named `name` */
export function getFieldMember(
  members: ObjectMember[] | undefined,
  name: string,
): FieldMember | undefined {
  return members?.find(
    (member): member is FieldMember => member.kind === 'field' && member.name === name,
  )
}

/** The item members of an item's nested list, from its form node */
export function getChildMembers(
  member: ArrayOfObjectsItemMember,
  childrenField: string,
): ArrayOfObjectsItemMember[] {
  const field: unknown = getFieldMember(member.item.members, childrenField)?.field
  return isRecord(field) && Array.isArray(field.members) ? field.members.filter(isItemMember) : []
}
