
import { useEffect, useRef, useState } from "react"
import { framer } from "@framer/plugin"
import {
  compressImage,
  formatBytes,
  outputFilename,
  type OutputFormat,
} from "./compression"
import "./App.css"

const MAX_IMAGES = 5

type ResultSettings = {
  format: OutputFormat
  quality: number
}

type QueueItem = {
  id: string
  file: File
  originalUrl: string
  compressedBlob: Blob | null
  compressedUrl: string | null
  resultSettings: ResultSettings | null
  status: "ready" | "compressing" | "done" | "error"
  error?: string
}

const FORMAT_OPTIONS: {
  value: OutputFormat
  label: string
  detail: string
}[] = [
  { value: "webp", label: "WebP", detail: "Smaller files" },
  { value: "jpeg", label: "JPEG", detail: "Photographs" },
  { value: "png", label: "PNG", detail: "Lossless" },
]

function getSavings(originalSize: number, compressedSize: number) {
  const amount = originalSize - compressedSize

  return {
    amount: Math.abs(amount),
    percent:
      originalSize > 0
        ? Math.abs((amount / originalSize) * 100)
        : 0,
    larger: amount < 0,
  }
}

// function formatLabel(format: OutputFormat) {
//   return format === "jpeg" ? "JPEG" : format.toUpperCase()
// }

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M7 8.5h18v5H7zM7 18.5h11v5H7z" fill="currentColor" />
        <path
          d="m21 17 5 4-5 4"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}



function BeforeAfterPreview({
  originalUrl,
  compressedUrl,
  originalSize,
  compressedSize,
}: {
  originalUrl: string
  compressedUrl: string
  originalSize: number
  compressedSize: number
}) {
  const [position, setPosition] = useState(50)
  const canvasRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  function updatePosition(clientX: number) {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const nextPosition = ((clientX - rect.left) / rect.width) * 100

    setPosition(Math.max(0, Math.min(100, nextPosition)))
  }

  return (
    <div
      ref={canvasRef}
      className="comparison-canvas"
      onPointerDown={(event) => {
        draggingRef.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        updatePosition(event.clientX)
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) {
          updatePosition(event.clientX)
        }
      }}
      onPointerUp={() => {
        draggingRef.current = false
      }}
      onPointerCancel={() => {
        draggingRef.current = false
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          setPosition((current) => Math.max(0, current - 2))
        } else if (event.key === "ArrowRight") {
          event.preventDefault()
          setPosition((current) => Math.min(100, current + 2))
        } else if (event.key === "Home") {
          event.preventDefault()
          setPosition(0)
        } else if (event.key === "End") {
          event.preventDefault()
          setPosition(100)
        }
      }}
      role="slider"
      tabIndex={0}
      aria-label="Compare original and compressed image"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`${Math.round(position)}% original visible from the left`}
    >
      <img
        className="comparison-image"
        src={originalUrl}
        alt="Original image"
        draggable={false}
      />

      <div
        className="comparison-after"
        style={{ clipPath: `inset(0 0 0 ${position}%)` }}
      >
        <img
          className="comparison-image"
          src={compressedUrl}
          alt="Compressed image"
          draggable={false}
        />
      </div>

      <div className="comparison-size comparison-size-before">
        <span>ORIGINAL</span>
        <strong>{formatBytes(originalSize)}</strong>
      </div>

      <div className="comparison-size comparison-size-after">
        <span>COMPRESSED</span>
        <strong>{formatBytes(compressedSize)}</strong>
      </div>

      <div
        className="comparison-divider"
        style={{ left: `${position}%` }}
      >
        <div className="comparison-handle">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m9 7-5 5 5 5M15 7l5 5-5 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  )
}


export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef<QueueItem[]>([])

  const [images, setImages] = useState<QueueItem[]>([])
  const [format, setFormat] = useState<OutputFormat>("webp")
  const [quality, setQuality] = useState(82)
  const [isCompressing, setIsCompressing] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // Keep the latest queue available to the unmount cleanup.
  imagesRef.current = images

  useEffect(() => {
    return () => {
      for (const item of imagesRef.current) {
        URL.revokeObjectURL(item.originalUrl)
        if (item.compressedUrl) {
          URL.revokeObjectURL(item.compressedUrl)
        }
      }
    }
  }, [])

  const resultIsCurrent = (item: QueueItem) =>
    Boolean(
      item.compressedBlob &&
        item.resultSettings &&
        item.resultSettings.format === format &&
        (format === "png" ||
          item.resultSettings.quality === quality),
    )

  const completedCount = images.filter(
    (item) => item.status === "done" && resultIsCurrent(item),
  ).length

  const totalOriginalBytes = images.reduce(
    (total, item) => total + item.file.size,
    0,
  )

  const totalCompressedBytes = images.reduce(
    (total, item) =>
      total +
      (resultIsCurrent(item) && item.compressedBlob
        ? item.compressedBlob.size
        : 0),
    0,
  )

  const totalSavings = getSavings(
    totalOriginalBytes,
    totalCompressedBytes,
  )

  function updateItem(id: string, update: Partial<QueueItem>) {
    setImages((current) =>
      current.map((item) =>
        item.id === id ? { ...item, ...update } : item,
      ),
    )
  }

  function addFiles(fileList: FileList | File[]) {
    if (isCompressing) return

    const incoming = Array.from(fileList)
    if (incoming.length === 0) return

    setError(null)
    setStatus(null)

    const validFiles: File[] = []
    const invalidNames: string[] = []
    const duplicateNames: string[] = []

    for (const file of incoming) {
      if (!file.type.startsWith("image/")) {
        invalidNames.push(file.name)
        continue
      }

      const duplicate = [...images, ...validFiles.map((candidate) => ({
        file: candidate,
      } as QueueItem))].some(
        (item) =>
          item.file.name === file.name &&
          item.file.size === file.size &&
          item.file.lastModified === file.lastModified,
      )

      if (duplicate) {
        duplicateNames.push(file.name)
        continue
      }

      validFiles.push(file)
    }

    const availableSlots = Math.max(0, MAX_IMAGES - images.length)
    const acceptedFiles = validFiles.slice(0, availableSlots)
    const overflowCount = validFiles.length - acceptedFiles.length

    if (acceptedFiles.length > 0) {
      const newItems: QueueItem[] = acceptedFiles.map((file) => ({
        id: createId(),
        file,
        originalUrl: URL.createObjectURL(file),
        compressedBlob: null,
        compressedUrl: null,
        resultSettings: null,
        status: "ready",
      }))

      setImages((current) => [...current, ...newItems])
    }

    const messages: string[] = []

    if (invalidNames.length > 0) {
      messages.push(
        `${invalidNames.length} unsupported file${invalidNames.length === 1 ? "" : "s"} skipped.`,
      )
    }

    if (duplicateNames.length > 0) {
      messages.push(
        `${duplicateNames.length} duplicate image${duplicateNames.length === 1 ? "" : "s"} skipped.`,
      )
    }

    if (overflowCount > 0) {
      messages.push(
        `Cinch supports up to ${MAX_IMAGES} images per batch. ${overflowCount} image${overflowCount === 1 ? " was" : "s were"} not added.`,
      )
    }

    if (messages.length > 0) {
      setError(messages.join(" "))
    } else if (acceptedFiles.length > 0) {
      setStatus(
        `${acceptedFiles.length} image${acceptedFiles.length === 1 ? "" : "s"} added to your batch.`,
      )
    }
  }

  function removeImage(id: string) {
    if (isCompressing) return

    const item = images.find((image) => image.id === id)
    if (!item) return

    URL.revokeObjectURL(item.originalUrl)
    if (item.compressedUrl) {
      URL.revokeObjectURL(item.compressedUrl)
    }

    setImages((current) =>
      current.filter((image) => image.id !== id),
    )
    setError(null)
    setStatus("Image removed from the batch.")
  }

  function clearBatch() {
    if (isCompressing) return

    for (const item of images) {
      URL.revokeObjectURL(item.originalUrl)
      if (item.compressedUrl) {
        URL.revokeObjectURL(item.compressedUrl)
      }
    }

    setImages([])
    setError(null)
    setStatus("Batch cleared. Add images to start again.")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  async function handleCompress() {
    if (images.length === 0 || isCompressing) return

    setIsCompressing(true)
    setError(null)
    setStatus(null)

    // Clear previous outputs before starting the new batch.
    for (const item of images) {
      if (item.compressedUrl) {
        URL.revokeObjectURL(item.compressedUrl)
      }
    }

    const batch = [...images]

    setImages((current) =>
      current.map((item) => ({
        ...item,
        compressedBlob: null,
        compressedUrl: null,
        resultSettings: null,
        status: "ready",
        error: undefined,
      })),
    )

    let succeeded = 0
    let failed = 0

    try {
      for (const item of batch) {
        updateItem(item.id, {
          status: "compressing",
          error: undefined,
        })

        try {
          const result = await compressImage(
            item.file,
            format,
            quality,
          )

          updateItem(item.id, {
            compressedBlob: result.blob,
            compressedUrl: URL.createObjectURL(result.blob),
            resultSettings: { format, quality },
            status: "done",
            error: undefined,
          })

          succeeded += 1
        } catch (compressionError) {
          updateItem(item.id, {
            status: "error",
            error:
              compressionError instanceof Error
                ? compressionError.message
                : "Compression failed for this image.",
          })

          failed += 1
        }
      }

      setStatus(
        failed === 0
          ? `Batch complete. ${succeeded} image${succeeded === 1 ? "" : "s"} compressed successfully.`
          : `Batch finished with ${succeeded} successful and ${failed} failed image${failed === 1 ? "" : "s"}.`,
      )
    } finally {
      setIsCompressing(false)
    }
  }

  function handleDownload(item: QueueItem) {
    if (
      !item.compressedBlob ||
      !resultIsCurrent(item)
    ) {
      return
    }

    const url = URL.createObjectURL(item.compressedBlob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = outputFilename(item.file.name, format)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function handleAddToFramer(item: QueueItem) {
    if (
      !item.compressedBlob ||
      !resultIsCurrent(item) ||
      addingId
    ) {
      return
    }

    setAddingId(item.id)
    setError(null)
    setStatus(null)

    try {
      const filename = outputFilename(item.file.name, format)
      const optimizedFile = new File([item.compressedBlob], filename, {
        type: item.compressedBlob.type,
        lastModified: Date.now(),
      })

      await framer.addImage({
        image: optimizedFile,
        name: filename,
        altText: item.file.name.replace(/\.[^/.]+$/, ""),
      })

      setStatus(`${item.file.name} added to your Framer canvas.`)
    } catch (addError) {
      setError(
        addError instanceof Error
          ? `Could not add ${item.file.name} to Framer: ${addError.message}`
          : `Could not add ${item.file.name} to Framer. Try downloading it instead.`,
      )
    } finally {
      setAddingId(null)
    }
  }

  const settingsChanged = images.some(
    (item) => item.compressedBlob && !resultIsCurrent(item),
  )

  return (
    <div className="cinch-app">
      <header className="cinch-header">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <div className="brand-name">CINCH<span>.</span></div>
            <div className="brand-caption">IMAGE OPTIMIZER</div>
          </div>
        </div>
        <div className="local-pill">
          <span className="local-dot" /> LOCAL
        </div>
      </header>

      <main className="cinch-main">
        <div className="intro-kicker">
          <span /> THE LIGHTER SIDE OF DESIGN
        </div>
        <h1>
          Less weight.
          <br />
          <span>Same impact.</span>
        </h1>
        <p className="intro-copy">
          Make images lighter before they land in your project.
        </p>

        <label
          className={`dropzone${dragging ? " dropzone-active" : ""}${images.length >= MAX_IMAGES ? " dropzone-full" : ""}`}
          onDragOver={(event) => {
            event.preventDefault()
            if (!isCompressing) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            addFiles(event.dataTransfer.files)
          }}
        >
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            disabled={isCompressing || images.length >= MAX_IMAGES}
            onChange={(event) => {
              if (event.currentTarget.files) {
                addFiles(event.currentTarget.files)
              }
              event.currentTarget.value = ""
            }}
          />

          <div className="upload-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <strong>
            {images.length === 0
              ? "Drop images here"
              : images.length >= MAX_IMAGES
                ? "Batch limit reached"
                : "Drop more images here"}
          </strong>
          <span className="dropzone-sub">
            {images.length >= MAX_IMAGES ? (
              "Remove an image to make room"
            ) : (
              <>or <span className="inline-link">browse files</span></>
            )}
          </span>
          <span className="format-hint">
            {images.length} / {MAX_IMAGES} images · PNG · JPG · WEBP
          </span>
        </label>

        {images.length > 0 && (
          <>
            <section className="queue-panel" aria-label="Image batch">
              <div className="section-heading">
                <span>YOUR BATCH</span>
                <span className="queue-count">
                  {images.length} OF {MAX_IMAGES}
                </span>
              </div>

              <div className="queue-list">
                {images.map((item, index) => {
                  const current = resultIsCurrent(item)
                  const savings =
                    current && item.compressedBlob
                      ? getSavings(item.file.size, item.compressedBlob.size)
                      : null

                  return (
                    <article className="queue-item" key={item.id}>
                      <div className="queue-thumb">
                        <img src={item.originalUrl} alt="" />
                        <span className="queue-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>

                      <div className="queue-meta">
                        <strong title={item.file.name}>
                          {item.file.name}
                        </strong>
                        <span>{formatBytes(item.file.size)}</span>
                        <span className={`item-status item-status-${item.status}`}>
                          {item.status === "ready" && "Ready to compress"}
                          {item.status === "compressing" && "Compressing…"}
                          {item.status === "done" &&
                            (current ? "Compression complete" : "Settings changed")}
                          {item.status === "error" && "Compression failed"}
                        </span>
                      </div>

                      {!isCompressing && (
                        <button
                          className="icon-button"
                          type="button"
                          title={`Remove ${item.file.name}`}
                          aria-label={`Remove ${item.file.name}`}
                          onClick={() => removeImage(item.id)}
                        >
                          <svg viewBox="0 0 24 24" fill="none">
                            <path
                              d="m7 7 10 10M17 7 7 17"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      )}

                      {item.status === "error" && item.error && (
                        <p className="item-error">{item.error}</p>
                      )}

                      {current && item.compressedBlob && item.compressedUrl && (
                        
                      <div className="batch-result">
                        <BeforeAfterPreview
                          originalUrl={item.originalUrl}
                          compressedUrl={item.compressedUrl}
                          originalSize={item.file.size}
                          compressedSize={item.compressedBlob.size}
                        />

                        {savings && (
                          <div className="item-savings">
                            <span>
                              {savings.larger
                                ? `${savings.percent.toFixed(1)}% larger`
                                : `${formatBytes(savings.amount)} saved`}
                            </span>

                            <span
                              className={
                                savings.larger
                                  ? "savings-larger"
                                  : "savings-chip"
                              }
                            >
                              {savings.larger
                                ? "Try another format"
                                : `${savings.percent.toFixed(1)}% smaller`}
                            </span>
                          </div>
                        )}

                        <div className="result-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => handleDownload(item)}
                          >
                            Download
                          </button>

                          <button
                            className="primary-button add-button"
                            type="button"
                            onClick={() => handleAddToFramer(item)}
                            disabled={addingId !== null}
                          >
                            {addingId === item.id
                              ? "Adding…"
                              : "Add to Framer"}
                          </button>
                        </div>
                      </div>

                      )}
                    </article>
                  )
                })}
              </div>

              <div className="queue-footer">
                <span>
                  {completedCount} of {images.length} results ready
                </span>
                <button
                  className="text-button"
                  type="button"
                  onClick={clearBatch}
                  disabled={isCompressing}
                >
                  Clear batch
                </button>
              </div>
            </section>

            <section className="controls-panel" aria-label="Compression settings">
              <div className="section-heading">
                <span>COMPRESSION SETTINGS</span>
                <span className="setting-note">
                  {format === "png" ? "LOSSLESS" : "LOSSY"}
                </span>
              </div>

              <div className="format-options" role="group" aria-label="Output format">
                {FORMAT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`format-option${format === option.value ? " format-option-active" : ""}`}
                    onClick={() => {
                      setFormat(option.value)
                      setError(null)
                      setStatus(null)
                    }}
                    aria-pressed={format === option.value}
                    disabled={isCompressing}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.detail}</span>
                  </button>
                ))}
              </div>

              <div className={`quality-control${format === "png" ? " quality-disabled" : ""}`}>
                <div className="quality-label-row">
                  <label htmlFor="quality-slider">Image quality</label>
                  <strong>{format === "png" ? "N/A" : `${quality}%`}</strong>
                </div>
                <input
                  id="quality-slider"
                  className="quality-slider"
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={quality}
                  disabled={format === "png" || isCompressing}
                  onChange={(event) => setQuality(Number(event.currentTarget.value))}
                />
                <div className="slider-captions">
                  <span>Smaller file</span>
                  <span>Higher detail</span>
                </div>
                {format === "png" && (
                  <p className="quality-help">
                    PNG is lossless, so the quality slider does not apply.
                  </p>
                )}
              </div>

              {settingsChanged && (
                <p className="outdated-note">
                  Settings changed. Compress again to update your results.
                </p>
              )}

              <button
                className="primary-button"
                type="button"
                onClick={handleCompress}
                disabled={isCompressing || images.length === 0}
              >
                {isCompressing ? (
                  <>
                    <span className="spinner" />
                    Compressing batch…
                  </>
                ) : (
                  <>
                    {completedCount > 0 ? "Re-compress batch" : "Compress batch"}
                    <span aria-hidden="true">→</span>
                  </>
                )}
              </button>

              <p className="framer-note">
                Images are processed one at a time. A failed image won't stop the rest of the batch.
              </p>
            </section>

            {completedCount > 0 && !isCompressing && (
              <section className="results-panel" aria-label="Batch summary">
                <div className="section-heading">
                  <span>BATCH SUMMARY</span>
                  <span className={`savings-chip${totalSavings.larger ? " savings-larger" : ""}`}>
                    {totalSavings.larger
                      ? `${totalSavings.percent.toFixed(1)}% larger`
                      : `${totalSavings.percent.toFixed(1)}% saved`}
                  </span>
                </div>
                <div className="summary-stats">
                  <div>
                    <span>ORIGINAL TOTAL</span>
                    <strong>{formatBytes(totalOriginalBytes)}</strong>
                  </div>
                  <div>
                    <span>COMPRESSED TOTAL</span>
                    <strong>{formatBytes(totalCompressedBytes)}</strong>
                  </div>
                  <div>
                    <span>NET SAVINGS</span>
                    <strong>
                      {totalSavings.larger
                        ? `+${formatBytes(totalSavings.amount)}`
                        : formatBytes(totalSavings.amount)}
                    </strong>
                  </div>
                </div>
                <p className="framer-note">
                  Download each result above. Batch ZIP download can be added next.
                </p>
              </section>
            )}
          </>
        )}

        {error && (
          <div className="feedback feedback-error" role="alert">
            <span>!</span>
            {error}
          </div>
        )}

        {status && !error && (
          <div className="feedback" role="status">
            <span>✓</span>
            {status}
          </div>
        )}

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
            <strong>Your images stay yours.</strong> Compression runs locally. No external compression service.
          </span>
        </footer>
      </main>
    </div>
  )
}
