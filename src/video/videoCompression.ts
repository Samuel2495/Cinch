import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny"

export const MAX_VIDEOS = 5
export const MAX_VIDEO_SIZE = 150 * 1024 * 1024
export const MAX_VIDEO_DURATION = 60

/** 1 (smallest file) to 100 (closest to the source bitrate) */
export type VideoQuality = number
export const MIN_VIDEO_QUALITY = 1
export const MAX_VIDEO_QUALITY = 100
export const DEFAULT_VIDEO_QUALITY = 50
export type VideoResolution = "original" | "1080" | "720" | "480"

export interface VideoMetadata {
  duration: number
  width: number
  height: number
  fps: number | null
  hasAudio: boolean
  format: string
}

export interface VideoSettings {
  resolution: VideoResolution
  quality: VideoQuality
  includeAudio: boolean
}

export interface VideoCompressionResult {
  blob: Blob
  filename: string
}

export function formatVideoBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`

  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = units[0]

  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024
    unit = units[index]
  }

  return `${value.toFixed(1)} ${unit}`
}

export function formatVideoDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—"
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`
}

export function getVideoOutputFilename(filename: string): string {
  const name = filename.replace(/\.[^/.]+$/, "")
  return `${name}-cinch.mp4`
}

export function validateVideoFile(file: File): string | null {
  if (file.size > MAX_VIDEO_SIZE) {
    return `This video exceeds the ${formatVideoBytes(MAX_VIDEO_SIZE)} file-size limit.`
  }

  const hasVideoType = file.type.startsWith("video/")
  const hasSupportedExtension = /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(file.name)

  if (!hasVideoType && !hasSupportedExtension) {
    return "Choose a video file, such as MP4, MOV, or WebM."
  }

  return null
}

export async function readVideoMetadata(file: File): Promise<VideoMetadata> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })

  const duration = await input.computeDuration()
  const videoTrack = await input.getPrimaryVideoTrack()

  if (!videoTrack) {
    throw new Error("No video track was found in this file.")
  }

  const [width, height, frameRateMetrics, audioTrack] = await Promise.all([
    videoTrack.getDisplayWidth(),
    videoTrack.getDisplayHeight(),
    videoTrack.computeFrameRateMetrics().catch(() => null),
    input.getPrimaryAudioTrack(),
  ])

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("The video's duration could not be determined.")
  }

  if (duration > MAX_VIDEO_DURATION) {
    throw new Error(
      `This video is ${formatVideoDuration(duration)} long. The limit is ${MAX_VIDEO_DURATION} seconds.`,
    )
  }

  return {
    duration,
    width,
    height,
    fps: frameRateMetrics?.bestGuessFrameRate ?? null,
    hasAudio: Boolean(audioTrack),
    format: file.type || file.name.split(".").pop()?.toUpperCase() || "Unknown",
  }
}

function getTargetWidth(
  resolution: VideoResolution,
  originalWidth: number,
  originalHeight: number,
): number {
  if (resolution === "original") return originalWidth

  const targetHeight = Number(resolution)
  if (originalHeight <= targetHeight) return originalWidth

  // Width-only scaling preserves aspect ratio. Round down to an even width.
  return Math.max(
    2,
    Math.floor((originalWidth * targetHeight) / originalHeight / 2) * 2,
  )
}

const ASSUMED_AUDIO_BITRATE = 128_000
const OUTPUT_AUDIO_BITRATE = 96_000
const MIN_VIDEO_BITRATE = 150_000

/**
 * Picks a target video bitrate relative to the SOURCE bitrate, so the output can
 * never balloon past the input. The slider maps to 15%-90% of the source bitrate
 * (H.264 output is usually less efficient than HEVC/VP9 phone footage, so we never
 * target 100%). Bitrate is also reduced when the resolution is scaled down.
 */
function getTargetVideoBitrate(
  file: File,
  metadata: VideoMetadata,
  settings: VideoSettings,
  targetWidth: number,
): number {
  const totalBitrate = (file.size * 8) / metadata.duration
  const audioBitrate = metadata.hasAudio ? ASSUMED_AUDIO_BITRATE : 0
  const sourceVideoBitrate = Math.max(MIN_VIDEO_BITRATE, totalBitrate - audioBitrate)

  const q = Math.max(MIN_VIDEO_QUALITY, Math.min(MAX_VIDEO_QUALITY, settings.quality)) / 100
  const qualityFactor = 0.15 + q * 0.75

  const scale = targetWidth / metadata.width
  const resolutionFactor = scale < 1 ? Math.pow(scale * scale, 0.75) : 1

  const target = sourceVideoBitrate * qualityFactor * resolutionFactor
  return Math.round(Math.max(MIN_VIDEO_BITRATE, Math.min(target, sourceVideoBitrate * 0.9)))
}

export async function compressVideo(
  file: File,
  metadata: VideoMetadata,
  settings: VideoSettings,
  onProgress?: (progress: number) => void,
): Promise<VideoCompressionResult> {
  const validationError = validateVideoFile(file)
  if (validationError) throw new Error(validationError)

  if (metadata.duration > MAX_VIDEO_DURATION) {
    throw new Error(`Videos must be ${MAX_VIDEO_DURATION} seconds or shorter.`)
  }

  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })
  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat(),
    target,
  })

  const targetWidth = getTargetWidth(settings.resolution, metadata.width, metadata.height)
  const videoBitrate = getTargetVideoBitrate(file, metadata, settings, targetWidth)

  const conversion = await Conversion.init({
    input,
    output,
    tracks: "primary",
    video: {
      width: targetWidth,
      bitrate: videoBitrate,
    },
    audio: settings.includeAudio ? { bitrate: OUTPUT_AUDIO_BITRATE } : { discard: true },
    tags: {},
  })

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks
      .map((entry) => entry.reason)
      .filter(Boolean)
    throw new Error(
      reasons.length
        ? `This video cannot be converted with the available browser codecs (${reasons.join(", ")}). Try another video or browser.`
        : "This video cannot be converted with the codecs available in this browser. Try another video or browser.",
    )
  }

  conversion.onProgress = (progress) => {
    onProgress?.(Math.max(0, Math.min(1, progress)))
  }

  try {
    await conversion.execute()
    const buffer = target.buffer

    if (!buffer || buffer.byteLength === 0) {
      throw new Error("The encoder returned an empty video.")
    }

    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      filename: getVideoOutputFilename(file.name),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown conversion error"
    throw new Error(
      `Video compression failed: ${message}. Your original file has not been changed.`,
    )
  }
}