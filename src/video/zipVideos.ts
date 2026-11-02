import { zip } from "fflate"

export interface ZipEntry {
  blob: Blob
  filename: string
}

/** "clip.mp4" → "clip.mp4", then "clip (2).mp4", "clip (3).mp4" … so duplicate names never overwrite each other. */
function uniqueNames(names: string[]): string[] {
  const used = new Map<string, number>()
  return names.map((name) => {
    const count = (used.get(name) ?? 0) + 1
    used.set(name, count)
    if (count === 1) return name
    const dot = name.lastIndexOf(".")
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`
  })
}

/**
 * Builds a ZIP entirely in the browser. MP4 is already compressed, so entries are
 * stored (level 0): fast, and no CPU wasted trying to shrink them further.
 * fflate's async `zip` runs in its own worker, so the UI stays responsive.
 */
export async function zipVideos(entries: ZipEntry[]): Promise<Blob> {
  const names = uniqueNames(entries.map((e) => e.filename))
  const files: Record<string, Uint8Array> = {}
  for (let i = 0; i < entries.length; i += 1) {
    files[names[i]] = new Uint8Array(await entries[i].blob.arrayBuffer())
  }
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data)))
  })
  return new Blob([zipped as BlobPart], { type: "application/zip" })
}
