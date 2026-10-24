export type OutputFormat = "webp" | "jpeg" | "png"

export type CompressionResult = {
  blob: Blob
  width: number
  height: number
  mimeType: string
}

const MIME_TYPES: Record<OutputFormat, string> = {
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
}

/**
 * Compresses a single image locally in the browser. No network requests are made.
 * The browser's native Canvas encoders are used for the MVP; PNG is lossless and
 * ignores the quality value by design.
 */
export async function compressImage(
  file: File,
  format: OutputFormat,
  quality: number,
): Promise<CompressionResult> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a valid image file.")
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("This image could not be decoded by your browser. Try a PNG, JPEG, or WebP image.")
  }

  try {
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height

    const context = canvas.getContext("2d", { alpha: format !== "jpeg" })
    if (!context) {
      throw new Error("Your browser could not create an image-processing canvas.")
    }

    // JPEG has no transparency. Use white as the background instead of black.
    if (format === "jpeg") {
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, canvas.width, canvas.height)
    }

    context.drawImage(bitmap, 0, 0)
    const requestedMimeType = MIME_TYPES[format]
    const normalizedQuality = Math.max(0.1, Math.min(1, quality / 100))

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (!result) {
            reject(new Error("The browser could not encode this image. Try another format."))
            return
          }

          // Some browsers silently fall back to PNG for unsupported formats.
          if (result.type !== requestedMimeType) {
            reject(
              new Error(
                `${format.toUpperCase()} encoding is not supported by this browser. Try WebP, JPEG, or PNG instead.`,
              ),
            )
            return
          }

          resolve(result)
        },
        requestedMimeType,
        format === "png" ? undefined : normalizedQuality,
      )
    })

    return {
      blob,
      width: bitmap.width,
      height: bitmap.height,
      mimeType: blob.type,
    }
  } finally {
    bitmap.close()
  }
}

export function outputFilename(sourceName: string, format: OutputFormat): string {
  const baseName = sourceName.replace(/\.[^/.]+$/, "").trim() || "cinch-image"
  const extension = format === "jpeg" ? "jpg" : format
  return `${baseName}-cinch.${extension}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
