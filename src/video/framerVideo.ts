import { framer } from "@framer/plugin"

/** Framer's built-in Video component (documented module URL). */
const VIDEO_COMPONENT_URL = "https://framer.com/m/framer/Video.js#Video"
const INSERT_WIDTH = 560

export function canAddVideoToFramer(): boolean {
  return framer.isAllowedTo("addComponentInstance")
}

/**
 * Uploads the compressed MP4 to the project, then inserts a Video component that plays it.
 * Aspect ratio is kept using the output dimensions, so the layer isn't squashed.
 */
export async function addVideoToFramer(blob: Blob, filename: string, width?: number, height?: number): Promise<void> {
  const file = new File([blob], filename, { type: "video/mp4" })
  const asset = await framer.uploadFile({ file, name: filename })
  const ratio = width && height ? height / width : 9 / 16
  await framer.addComponentInstance({
    url: VIDEO_COMPONENT_URL,
    attributes: {
      width: `${INSERT_WIDTH}px`,
      height: `${Math.round(INSERT_WIDTH * ratio)}px`,
      controls: { srcType: "Upload", srcFile: asset },
    },
  })
}
