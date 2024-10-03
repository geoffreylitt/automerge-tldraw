import { TLRecord, RecordId, TLStore } from "@tldraw/tldraw"
import * as Automerge from "@automerge/automerge/next"

/** Convert a value from an automerge doc to a value consumable by TLDraw.
 *  The main thing we need to do is convert RawStrings to regular strings,
 *  which can be achieved with a JSON.parse/stringify roundtrip.
 */
export function automergeValueToTldrawValue(value: any): any {
  return JSON.parse(JSON.stringify(value))
}

export function translateAutomergePatchesToTLStoreUpdates(
  patches: Automerge.Patch[],
  store: TLStore
): [TLRecord[], TLRecord["id"][]] {
  const toRemove: TLRecord["id"][] = []
  const updatedObjects: { [id: string]: TLRecord } = {}

  patches.forEach((rawPatch) => {
    let patch = rawPatch
    if (
      rawPatch.action === "put" &&
      rawPatch.value instanceof Automerge.RawString
    ) {
      patch = {
        ...rawPatch,
        value: rawPatch.value.toString(),
      }
    }

    if (!isStorePatch(patch)) return

    const id = pathToId(patch.path as string[])
    const record =
      updatedObjects[id] || JSON.parse(JSON.stringify(store.get(id) || {}))

    switch (patch.action) {
      case "insert": {
        updatedObjects[id] = applyInsertToObject(patch, record)
        break
      }
      case "put":
        updatedObjects[id] = applyPutToObject(patch, record)
        break
      //@ts-expect-error not sure why this is missing
      case "update": {
        updatedObjects[id] = applyUpdateToObject(patch, record)
        break
      }
      case "splice": {
        updatedObjects[id] = applySpliceToObject(patch, record)
        break
      }
      case "del": {
        const id = pathToId(patch.path as string[])
        toRemove.push(id as TLRecord["id"])
        break
      }
      default: {
        console.error("Unsupported patch:", patch)
      }
    }
  })
  const toPut = Object.values(updatedObjects)
  return [toPut, toRemove]
}

export function applyAutomergePatchesToTLStore(
  patches: Automerge.Patch[],
  store: TLStore
) {
  const [toPut, toRemove] = translateAutomergePatchesToTLStoreUpdates(
    patches,
    store
  )

  store.mergeRemoteChanges(() => {
    if (toRemove.length) store.remove(toRemove)
    if (toPut.length) store.put(toPut)
  })
}

const isStorePatch = (patch: Automerge.Patch): boolean => {
  return patch.path[0] === "store" && patch.path.length > 1
}

// path: ["store", "camera:page:page", "x"] => "camera:page:page"
const pathToId = (path: string[]): RecordId<any> => {
  return path[1] as RecordId<any>
}

const applyInsertToObject = (patch: Automerge.Patch, object: any): TLRecord => {
  //@ts-expect-error values does indeed exist on patch... not sure why the type is wrong
  const { path, values } = patch
  let current = object
  const insertionPoint = path[path.length - 1]
  const pathEnd = path[path.length - 2]
  const parts = path.slice(2, -2)
  for (const part of parts) {
    if (current[part] === undefined) {
      throw new Error("NO WAY")
    }
    current = current[part]
  }
  // splice is a mutator... yay.
  const clone = current[pathEnd].slice(0)
  clone.splice(insertionPoint, 0, ...values)
  current[pathEnd] = clone
  return object
}

const applyPutToObject = (patch: Automerge.Patch, object: any): TLRecord => {
  //@ts-expect-error values does indeed exist on patch... not sure why the type is wrong
  const { path, value } = patch
  let current = object
  // special case
  if (path.length === 2) {
    // this would be creating the object, but we have done
    return object
  }

  const parts = path.slice(2, -2)
  const property = path[path.length - 1]
  const target = path[path.length - 2]

  if (path.length === 3) {
    return { ...object, [property]: value }
  }

  // default case
  for (const part of parts) {
    current = current[part]
  }
  current[target] = { ...current[target], [property]: value }
  return object
}

const applyUpdateToObject = (patch: Automerge.Patch, object: any): TLRecord => {
  //@ts-expect-error values does indeed exist on patch... not sure why the type is wrong
  const { path, value } = patch
  let current = object
  const parts = path.slice(2, -1)
  const pathEnd = path[path.length - 1]
  for (const part of parts) {
    if (current[part] === undefined) {
      throw new Error("NO WAY")
    }
    current = current[part]
  }
  current[pathEnd] = value
  return object
}

const applySpliceToObject = (patch: Automerge.Patch, object: any): TLRecord => {
  //@ts-expect-error values does indeed exist on patch... not sure why the type is wrong
  const { path, value } = patch
  let current = object
  const insertionPoint = path[path.length - 1]
  const pathEnd = path[path.length - 2]
  const parts = path.slice(2, -2)
  for (const part of parts) {
    if (current[part] === undefined) {
      throw new Error("NO WAY")
    }
    current = current[part]
  }
  // TODO: we're not supporting actual splices yet because TLDraw won't generate them natively
  if (insertionPoint !== 0) {
    throw new Error("Splices are not supported yet")
  }
  current[pathEnd] = value // .splice(insertionPoint, 0, value)
  return object
}
