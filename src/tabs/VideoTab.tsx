import { useEffect, useRef, useState } from "react"
import {
  compressVideo,
  DEFAULT_VIDEO_QUALITY,
  MAX_VIDEO_QUALITY,
  MIN_VIDEO_QUALITY,
  formatVideoBytes,
  formatVideoDuration,
  MAX_VIDEOS,
  MAX_VIDEO_SIZE,
  readVideoMetadata,
  validateVideoFile,
  type VideoMetadata,
  type VideoResolution,
} from "../video/videoCompression"
import { addVideoToFramer, canAddVideoToFramer } from "../video/framerVideo"
import { zipVideos } from "../video/zipVideos"

type VideoStatus = "ready" | "processing" | "done" | "error"

interface VideoItem {
  id: string
  file: File
  metadata: VideoMetadata | null
  status: VideoStatus
  progress: number
  error: string | null
  outputBlob: Blob | null
  outputUrl: string | null
  outputFilename: string | null
  addedToFramer: boolean
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function VideoTab() {
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<VideoItem[]>([])
  const [items, setItems] = useState<VideoItem[]>([])
  const [resolution, setResolution] = useState<VideoResolution>("720")
  const [quality, setQuality] = useState<number>(DEFAULT_VIDEO_QUALITY)
  const [includeAudio, setIncludeAudio] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ index: number; total: number } | null>(null)
  const [isZipping, setIsZipping] = useState(false)
  const [framerBusyId, setFramerBusyId] = useState<string | null>(null)
  const stopRef = useRef(false)

  itemsRef.current = items

  useEffect(() => {
    return () => {
      stopRef.current = true
      for (const item of itemsRef.current) {
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl)
      }
    }
  }, [])

  async function addFiles(fileList: FileList | File[]) {
    setNotice(null)
    const selectedFiles = Array.from(fileList)
    if (!selectedFiles.length) return

    const existingKeys = new Set(
      items.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`),
    )
    const uniqueFiles: File[] = []

    for (const file of selectedFiles) {
      const key = `${file.name}:${file.size}:${file.lastModified}`
      if (existingKeys.has(key)) continue
      existingKeys.add(key)
      uniqueFiles.push(file)
    }

    const availableSlots = Math.max(0, MAX_VIDEOS - items.length)
    if (availableSlots === 0) {
      setNotice(`Cinch supports up to ${MAX_VIDEOS} videos at a time.`)
      return
    }

    const acceptedFiles = uniqueFiles.slice(0, availableSlots)
    if (uniqueFiles.length > availableSlots) {
      setNotice(`Only ${availableSlots} more video(s) can be added.`)
    }

    setIsAdding(true)

    for (const file of acceptedFiles) {
      const id = createId()
      const validationError = validateVideoFile(file)
      const baseItem: VideoItem = {
        id,
        file,
        metadata: null,
        status: validationError ? "error" : "ready",
        progress: 0,
        error: validationError,
        outputBlob: null,
        outputUrl: null,
        outputFilename: null,
        addedToFramer: false,
      }

      setItems((current) => [...current, baseItem])
      if (validationError) continue

      try {
        const metadata = await readVideoMetadata(file)
        setItems((current) =>
          current.map((item) => item.id === id ? { ...item, metadata } : item),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not read this video."
        setItems((current) =>
          current.map((item) => item.id === id
            ? { ...item, status: "error", error: message }
            : item),
        )
      }
    }

    setIsAdding(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  function removeItem(id: string) {
    if (busyId === id) return
    const item = items.find((entry) => entry.id === id)
    if (item?.outputUrl) URL.revokeObjectURL(item.outputUrl)
    setItems((current) => current.filter((entry) => entry.id !== id))
  }

  /** Compresses one item and records the outcome on it. Never throws. */
  async function compressOne(item: VideoItem, settings: { resolution: VideoResolution; quality: number; includeAudio: boolean }) {
    if (!item.metadata) return

    setItems((current) => current.map((entry) => entry.id === item.id
      ? { ...entry, status: "processing", progress: 0, error: null }
      : entry))

    try {
      const result = await compressVideo(
        item.file,
        item.metadata,
        settings,
        (progress) => setItems((current) => current.map((entry) =>
          entry.id === item.id ? { ...entry, progress } : entry,
        )),
      )
      const outputUrl = URL.createObjectURL(result.blob)

      setItems((current) => current.map((entry) => {
        if (entry.id !== item.id) return entry
        if (entry.outputUrl) URL.revokeObjectURL(entry.outputUrl)
        return {
          ...entry,
          status: "done",
          progress: 1,
          outputBlob: result.blob,
          outputUrl,
          outputFilename: result.filename,
          addedToFramer: false,
        }
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Compression failed."
      setItems((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, status: "error", error: message }
        : entry))
    }
  }

  async function processItem(item: VideoItem) {
    if (!item.metadata || busyId || batch) return
    setBusyId(item.id)
    setNotice(null)
    try {
      await compressOne(item, { resolution, quality, includeAudio })
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Compresses every pending video one after another. Encoding is already hardware/CPU heavy,
   * so running files in parallel would only compete for the same encoder and memory.
   * Settings are captured once so changing the sliders mid-batch can't make the results inconsistent.
   */
  async function processAll() {
    if (busyId || batch) return
    const queue = itemsRef.current.filter(
      (item) => item.metadata && (item.status === "ready" || (item.status === "error" && !item.outputBlob)),
    )
    if (!queue.length) return

    const settings = { resolution, quality, includeAudio }
    stopRef.current = false
    setNotice(null)

    try {
      for (let index = 0; index < queue.length; index += 1) {
        if (stopRef.current) break
        const item = queue[index]
        // Skip videos the user removed while the batch was running.
        if (!itemsRef.current.some((entry) => entry.id === item.id)) continue
        setBatch({ index: index + 1, total: queue.length })
        setBusyId(item.id)
        await compressOne(item, settings)
      }
    } finally {
      setBusyId(null)
      setBatch(null)
      if (stopRef.current) setNotice("Stopped. Videos already compressed are ready to download.")
    }
  }

  async function downloadAllAsZip() {
    const ready = itemsRef.current.filter((item) => item.outputBlob)
    if (ready.length < 1 || isZipping) return
    setIsZipping(true)
    setNotice(null)
    try {
      const zipBlob = await zipVideos(
        ready.map((item) => ({ blob: item.outputBlob as Blob, filename: item.outputFilename ?? "cinch-video.mp4" })),
      )
      downloadBlob(zipBlob, "cinch-videos.zip")
    } catch (error) {
      setNotice(`Could not create the ZIP: ${error instanceof Error ? error.message : "unknown error"}`)
    } finally {
      setIsZipping(false)
    }
  }

  async function addToFramer(item: VideoItem) {
    if (!item.outputBlob || framerBusyId) return
    if (!canAddVideoToFramer()) {
      setNotice("You don't have permission to add layers to this project.")
      return
    }
    setFramerBusyId(item.id)
    setNotice(null)
    try {
      await addVideoToFramer(
        item.outputBlob,
        item.outputFilename ?? "cinch-video.mp4",
        item.metadata?.width,
        item.metadata?.height,
      )
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, addedToFramer: true } : entry))
    } catch (error) {
      setNotice(`Could not add the video to Framer: ${error instanceof Error ? error.message : "unknown error"}`)
    } finally {
      setFramerBusyId(null)
    }
  }

  const totalOriginalBytes = items.reduce((sum, item) => sum + item.file.size, 0)
  const completed = items.filter((item) => item.outputBlob)
  const pending = items.filter(
    (item) => item.metadata && (item.status === "ready" || (item.status === "error" && !item.outputBlob)),
  )
  const totalOutputBytes = completed.reduce((sum, item) => sum + (item.outputBlob?.size ?? 0), 0)

  return (
    <div className="video-workspace">
      <div className="intro-kicker"><span /> LOCAL VIDEO COMPRESSION</div>
      <h1>Make videos lighter.<br /><span>Keep the moment.</span></h1>
      <p className="intro-copy">Compress video files on your device. No upload or external compression service.</p>

      <section className="video-panel">
        <div className="video-panel-heading"><span>ADD VIDEOS</span><span>{items.length} / {MAX_VIDEOS}</span></div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi"
          multiple
          disabled={isAdding || items.length >= MAX_VIDEOS}
          onChange={(event) => {
            if (event.currentTarget.files) void addFiles(event.currentTarget.files)
            event.currentTarget.value = ""
          }}
        />
        <button
          type="button"
          className="video-dropzone"
          disabled={isAdding || items.length >= MAX_VIDEOS}
          onClick={() => inputRef.current?.click()}
        >
          <strong>{isAdding ? "Reading video metadata…" : "＋ Choose video files"}</strong>
          <span>MP4 · MOV · WebM · MKV · AVI</span>
          <span>Maximum {formatVideoBytes(MAX_VIDEO_SIZE)} each · {60}s per video</span>
        </button>
        <p className="video-limit-note">The browser must support the input codec and an MP4-compatible output encoder. Some files may not be convertible.</p>
      </section>
      <section className="video-panel" aria-label="Video queue">
        <div className="video-panel-heading"><span>YOUR VIDEO QUEUE</span><span>{items.length} FILE{items.length === 1 ? "" : "S"}</span></div>
        <div className="video-queue">
          {items.length === 0 && <div className="video-empty">Your video queue is empty. Add a video to get started.</div>}
          {items.map((item, index) => (
            <article className="video-item" key={item.id}>
              <div className="video-item-top">
                <div style={{ minWidth: 0 }}>
                  <div className="video-file-name">{String(index + 1).padStart(2, "0")} · {item.file.name}</div>
                  <span className="video-file-size">{formatVideoBytes(item.file.size)} · {item.status === "ready" ? "Ready" : item.status === "processing" ? "Compressing…" : item.status === "done" ? "Compression complete" : "Needs attention"}</span>
                </div>
                <button className="icon-button" type="button" aria-label={`Remove ${item.file.name}`} title="Remove video" disabled={busyId === item.id} onClick={() => removeItem(item.id)}>×</button>
              </div>

              {item.metadata && <div className="video-metadata">
                <div>Duration<strong>{formatVideoDuration(item.metadata.duration)}</strong></div>
                <div>Resolution<strong>{item.metadata.width} × {item.metadata.height}</strong></div>
                <div>Estimated FPS<strong>{item.metadata.fps ? item.metadata.fps.toFixed(2) : "Unavailable"}</strong></div>
                <div>Audio / source<strong>{item.metadata.hasAudio ? "Audio track" : "No audio"} · {item.metadata.format}</strong></div>
              </div>}

              {item.status === "processing" && <div>
                <div className="video-progress"><span style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>
                <p className="video-limit-note">Compressing… {Math.round(item.progress * 100)}%</p>
              </div>}

              {item.error && <p className="video-error" role="alert">{item.error}</p>}

              {item.status === "done" && item.outputBlob && item.outputUrl && <div className="video-result">
                <video src={item.outputUrl} controls preload="metadata" />
                <div className="video-result-summary">
                  Original: {formatVideoBytes(item.file.size)}<br />
                  Compressed: {formatVideoBytes(item.outputBlob.size)}<br />
                  {item.outputBlob.size < item.file.size
                    ? <strong>{((1 - item.outputBlob.size / item.file.size) * 100).toFixed(1)}% smaller</strong>
                    : <strong>Output is not smaller — try lower resolution or quality.</strong>}
                </div>
                <div className="video-actions">
                  <button className="video-action-button" type="button" onClick={() => downloadBlob(item.outputBlob!, item.outputFilename ?? "cinch-video.mp4")}>Download MP4</button>
                  <button
                    className="video-action-button primary"
                    type="button"
                    disabled={Boolean(framerBusyId)}
                    onClick={() => void addToFramer(item)}
                  >{framerBusyId === item.id ? "Adding…" : item.addedToFramer ? "Added ✓ Add again" : "Add to Framer"}</button>
                </div>
              </div>}

              {item.status !== "done" && item.status !== "processing" && <button
                className="video-action-button primary"
                type="button"
                disabled={!item.metadata || Boolean(busyId) || isAdding}
                onClick={() => void processItem(item)}
              >Compress video <span aria-hidden="true">→</span></button>}
            </article>
          ))}
        </div>
        {items.length > 1 && <div className="video-queue-footer">
          {batch ? (
            <>
              <p className="video-limit-note" role="status">Compressing video {batch.index} of {batch.total}…</p>
              <button className="video-action-button" type="button" onClick={() => { stopRef.current = true }}>Stop after current video</button>
            </>
          ) : (
            <button
              className="video-action-button primary"
              type="button"
              disabled={pending.length === 0 || Boolean(busyId) || isAdding}
              onClick={() => void processAll()}
            >{pending.length > 0 ? `Compress all ${pending.length} video${pending.length === 1 ? "" : "s"}` : "All videos processed"}</button>
          )}
        </div>}
      </section>

      {notice && <p className="video-notice" role="status">{notice}</p>}

      <section className="video-panel" aria-label="Video compression settings">
        <div className="video-panel-heading"><span>COMPRESSION SETTINGS</span><span>MP4 OUTPUT</span></div>
        <label className="video-field">
          Output resolution
          <select value={resolution} onChange={(event) => setResolution(event.target.value as VideoResolution)}>
            <option value="original">Keep original resolution</option>
            <option value="1080">Up to 1080p</option>
            <option value="720">Up to 720p</option>
            <option value="480">Up to 480p</option>
          </select>
        </label>
        <div className="video-field">
          <div className="video-slider-row">
            <label htmlFor="video-quality">Compression quality</label>
            <strong>{quality}%</strong>
          </div>
          <input
            id="video-quality"
            className="video-slider"
            type="range"
            min={MIN_VIDEO_QUALITY}
            max={MAX_VIDEO_QUALITY}
            step={1}
            value={quality}
            onChange={(event) => setQuality(Number(event.target.value))}
          />
          <div className="video-slider-captions"><span>Smaller file</span><span>Higher quality</span></div>
        </div>
        <label className="video-audio-toggle">
          <input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)} />
          Keep audio in the output
        </label>
        <p className="video-limit-note">Settings apply to the next compression. Smaller settings do not guarantee a smaller file for every source.</p>
      </section>

      {completed.length > 0 && <section className="video-panel">
        <div className="video-panel-heading"><span>BATCH SUMMARY</span><span>{completed.length} COMPLETE</span></div>
        <div className="video-batch-summary">
          Total queued source size: <strong>{formatVideoBytes(totalOriginalBytes)}</strong><br />
          Completed output size: <strong>{formatVideoBytes(totalOutputBytes)}</strong>
        </div>
        {completed.length > 1 && <button
          className="video-action-button primary video-zip-button"
          type="button"
          disabled={isZipping}
          onClick={() => void downloadAllAsZip()}
        >{isZipping ? "Preparing ZIP…" : `Download all ${completed.length} as ZIP`}</button>}
      </section>}

<footer className="privacy-note">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect
              x="5"
              y="10"
              width="14"
              height="10"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M8 10V7a4 4 0 1 1 8 0v3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span>
            <strong>Your videos stay yours.</strong> Compression runs locally. No external compression service.
          </span>
        </footer>
      </div>
  )
}