import { useCallback, useEffect, useRef, useState } from "react"
import { framer, type ImageAsset } from "@framer/plugin"
import {
  compressImage,
  formatBytes,
  outputFilename,
  type OutputFormat,
} from "../compression"

type ResultSettings = { format: OutputFormat; quality: number }

type PageImage = {
  id: string
  asset: ImageAsset
  name: string
  uses: number
  originalBytes: number | null
  mimeType: string | null
  selected: boolean
  status: "idle" | "compressing" | "done" | "error"
  error?: string
  compressedBlob: Blob | null
  compressedUrl: string | null
  resultSettings: ResultSettings | null
}

type ScannedNode = {
  id: string
  name?: string | null
  backgroundImage?: ImageAsset | null
}

const FORMAT_OPTIONS: { value: OutputFormat; label: string; detail: string }[] = [
  { value: "webp", label: "WebP", detail: "Smaller files" },
  { value: "jpeg", label: "JPEG", detail: "Photographs" },
  { value: "png", label: "PNG", detail: "Lossless" },
]

function extensionFor(mimeType: string) {
  const subtype = mimeType.split("/")[1]?.split("+")[0] ?? "png"
  return subtype === "jpeg" ? "jpg" : subtype
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "framer-image"
}

export default function PageTab({ active }: { active: boolean }) {
  const [items, setItems] = useState<PageImage[]>([])
  const [format, setFormat] = useState<OutputFormat>("webp")
  const [quality, setQuality] = useState(82)
  const [scanning, setScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [isCompressing, setIsCompressing] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const itemsRef = useRef<PageImage[]>([])
  const scanTokenRef = useRef(0)
  const addingLockRef = useRef(false)
  itemsRef.current = items

  const updateItem = useCallback((id: string, patch: Partial<PageImage>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }, [])

  const scanPage = useCallback(async () => {
    const token = ++scanTokenRef.current
    setScanning(true)
    setError(null)
    setStatus(null)

    try {
      let nodes: ScannedNode[]
      try {
        const root = await framer.getCanvasRoot()
        nodes = (await root.getNodesWithAttributeSet(
          "backgroundImage",
        )) as unknown as ScannedNode[]
      } catch {
        nodes = (await framer.getNodesWithAttributeSet(
          "backgroundImage",
        )) as unknown as ScannedNode[]
      }

      // One entry per unique image, remembering how many layers use it.
      const unique = new Map<string, { asset: ImageAsset; name: string; uses: number }>()
      for (const node of nodes) {
        const asset = node.backgroundImage
        if (!asset) continue
        const existing = unique.get(asset.id)
        if (existing) {
          existing.uses += 1
        } else {
          unique.set(asset.id, {
            asset,
            name: node.name?.trim() || "Image",
            uses: 1,
          })
        }
      }

      if (token !== scanTokenRef.current) return

      setItems((current) => {
        const previous = new Map(current.map((item) => [item.id, item]))
        const next: PageImage[] = []
        for (const [id, found] of unique) {
          const old = previous.get(id)
          next.push(
            old
              ? { ...old, asset: found.asset, uses: found.uses }
              : {
                  id,
                  asset: found.asset,
                  name: found.name,
                  uses: found.uses,
                  originalBytes: null,
                  mimeType: null,
                  selected: false,
                  status: "idle",
                  compressedBlob: null,
                  compressedUrl: null,
                  resultSettings: null,
                },
          )
        }
        // Release result URLs of images that no longer exist on the page.
        for (const old of current) {
          if (!unique.has(old.id) && old.compressedUrl) {
            URL.revokeObjectURL(old.compressedUrl)
          }
        }
        return next
      })
      setHasScanned(true)

      // Fill in original file sizes in the background.
      for (const [id, found] of unique) {
        if (token !== scanTokenRef.current) return
        const known = itemsRef.current.find((item) => item.id === id)
        if (known?.originalBytes != null) continue
        try {
          const data = await found.asset.getData()
          if (token !== scanTokenRef.current) return
          updateItem(id, {
            originalBytes: data.bytes.byteLength,
            mimeType: data.mimeType,
          })
        } catch {
          // Size stays unknown; compression will report a proper error.
        }
      }
    } catch (scanError) {
      setError(
        scanError instanceof Error
          ? `Could not read images from this page: ${scanError.message}`
          : "Could not read images from this page.",
      )
    } finally {
      if (token === scanTokenRef.current) setScanning(false)
    }
  }, [updateItem])

  // Scan whenever the tab is opened.
  useEffect(() => {
    if (active) void scanPage()
  }, [active, scanPage])

  // Release blob URLs on unmount.
  useEffect(() => {
    return () => {
      scanTokenRef.current += 1
      for (const item of itemsRef.current) {
        if (item.compressedUrl) URL.revokeObjectURL(item.compressedUrl)
      }
    }
  }, [])

  const resultIsCurrent = (item: PageImage) =>
    Boolean(
      item.compressedBlob &&
        item.resultSettings &&
        item.resultSettings.format === format &&
        (format === "png" || item.resultSettings.quality === quality),
    )

  const selectedItems = items.filter((item) => item.selected)
  const completedCount = items.filter(
    (item) => item.status === "done" && resultIsCurrent(item),
  ).length
  const settingsChanged = items.some(
    (item) => item.compressedBlob && !resultIsCurrent(item),
  )

  function toggle(id: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item,
      ),
    )
  }

  function setAllSelected(selected: boolean) {
    setItems((current) => current.map((item) => ({ ...item, selected })))
  }

  async function handleCompress() {
    if (selectedItems.length === 0 || isCompressing) return

    setIsCompressing(true)
    setError(null)
    setStatus(null)

    const batch = selectedItems.map((item) => ({ id: item.id, asset: item.asset, name: item.name }))
    let succeeded = 0
    let failed = 0

    try {
      for (const entry of batch) {
        const previous = itemsRef.current.find((item) => item.id === entry.id)
        if (previous?.compressedUrl) URL.revokeObjectURL(previous.compressedUrl)

        updateItem(entry.id, {
          status: "compressing",
          error: undefined,
          compressedBlob: null,
          compressedUrl: null,
          resultSettings: null,
        })

        try {
          const data = await entry.asset.getData()
          const sourceFile = new File(
            [data.bytes],
            `${safeName(entry.name)}.${extensionFor(data.mimeType)}`,
            { type: data.mimeType },
          )
          const result = await compressImage(sourceFile, format, quality)

          updateItem(entry.id, {
            originalBytes: sourceFile.size,
            mimeType: data.mimeType,
            compressedBlob: result.blob,
            compressedUrl: URL.createObjectURL(result.blob),
            resultSettings: { format, quality },
            status: "done",
          })
          succeeded += 1
        } catch (compressionError) {
          updateItem(entry.id, {
            status: "error",
            error:
              compressionError instanceof Error
                ? compressionError.message
                : "Compression failed for this image.",
          })
          failed += 1
        }
      }

      if (succeeded > 0 && failed === 0) {
        setStatus(`${succeeded} image${succeeded === 1 ? "" : "s"} compressed.`)
      } else if (succeeded > 0) {
        setStatus(`${succeeded} compressed, ${failed} failed.`)
      } else {
        setError("None of the selected images could be compressed.")
      }
    } finally {
      setIsCompressing(false)
    }
  }

  function handleDownload(item: PageImage) {
    if (!item.compressedBlob) return
    const url = URL.createObjectURL(item.compressedBlob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = outputFilename(safeName(item.name), format)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function handleAddToFramer(item: PageImage) {
    if (!item.compressedBlob || !resultIsCurrent(item) || addingId || addingLockRef.current) {
      return
    }

    addingLockRef.current = true
    setAddingId(item.id)
    setError(null)
    setStatus(null)

    try {
      const filename = outputFilename(safeName(item.name), format)
      const optimizedFile = new File([item.compressedBlob], filename, {
        type: item.compressedBlob.type,
        lastModified: Date.now(),
      })

      const bitmap = await createImageBitmap(item.compressedBlob)
      const naturalWidth = bitmap.width
      const naturalHeight = bitmap.height
      bitmap.close()
      const scale = Math.min(1, 800 / naturalWidth)

      const asset = await framer.uploadImage({
        image: optimizedFile,
        name: filename,
        altText: item.asset.altText ?? item.name,
      })

      const layer = await framer.createFrameNode({
        name: filename,
        width: `${Math.max(1, Math.round(naturalWidth * scale))}px`,
        height: `${Math.max(1, Math.round(naturalHeight * scale))}px`,
        backgroundImage: asset,
      })

      if (!layer) throw new Error("Framer did not create the image layer.")
      await layer.zoomIntoView()

      setStatus(`${item.name} added to your Framer canvas.`)
    } catch (addError) {
      setError(
        addError instanceof Error
          ? `Could not add ${item.name} to Framer: ${addError.message}`
          : `Could not add ${item.name} to Framer. Try downloading it instead.`,
      )
    } finally {
      addingLockRef.current = false
      setAddingId(null)
    }
  }

  const allSelected = items.length > 0 && selectedItems.length === items.length

  return (
    <>
      <section className="queue-panel" aria-label="Images on this page">
        <div className="section-heading">
          <span>IMAGES ON THIS PAGE</span>
          <span className="queue-count">
            {selectedItems.length} OF {items.length} SELECTED
          </span>
        </div>

        <div className="page-toolbar">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void scanPage()}
            disabled={scanning || isCompressing}
          >
            {scanning ? "Scanning…" : "Rescan page"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setAllSelected(!allSelected)}
            disabled={items.length === 0 || isCompressing}
          >
            {allSelected ? "Select none" : "Select all"}
          </button>
        </div>

        {items.length === 0 ? (
          <p className="page-empty">
            {scanning
              ? "Looking for images on this page…"
              : hasScanned
                ? "No images found on this page. Add an image layer or a background image, then rescan."
                : "Open this tab to scan the page for images."}
          </p>
        ) : (
          <div className="queue-list">
            {items.map((item) => {
              const current = resultIsCurrent(item)
              const savings =
                current && item.compressedBlob && item.originalBytes
                  ? {
                      amount: Math.abs(item.originalBytes - item.compressedBlob.size),
                      percent: Math.abs(
                        ((item.originalBytes - item.compressedBlob.size) / item.originalBytes) * 100,
                      ),
                      larger: item.compressedBlob.size > item.originalBytes,
                    }
                  : null

              return (
                <article className="queue-item" key={item.id}>
                  <div className="queue-thumb">
                    <img src={item.asset.thumbnailUrl} alt="" />
                  </div>

                  <div className="queue-meta">
                    <strong title={item.name}>{item.name}</strong>
                    <span>
                      {item.originalBytes != null ? formatBytes(item.originalBytes) : "Reading size…"}
                      {item.uses > 1 ? ` · used ${item.uses}×` : ""}
                    </span>
                    <span className={`item-status item-status-${item.status === "idle" ? "ready" : item.status}`}>
                      {item.status === "idle" && (item.selected ? "Selected" : "Not selected")}
                      {item.status === "compressing" && "Compressing…"}
                      {item.status === "done" &&
                        (current ? "Compression complete" : "Settings changed")}
                      {item.status === "error" && "Compression failed"}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={`page-check${item.selected ? " page-check-on" : ""}`}
                    role="checkbox"
                    aria-checked={item.selected}
                    aria-label={`Select ${item.name}`}
                    onClick={() => toggle(item.id)}
                    disabled={isCompressing}
                  >
                    {item.selected && (
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="m6 12.5 4 4 8-9"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>

                  {item.status === "error" && item.error && (
                    <p className="item-error">{item.error}</p>
                  )}

                  {current && item.compressedBlob && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      {savings && (
                        <div className="item-savings">
                          <span>
                            {savings.larger
                              ? `${savings.percent.toFixed(1)}% larger`
                              : `${formatBytes(savings.amount)} saved`}
                          </span>
                          <span className={savings.larger ? "savings-larger" : "savings-chip"}>
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
                          onClick={() => void handleAddToFramer(item)}
                          disabled={addingId !== null}
                        >
                          {addingId === item.id ? "Adding…" : "Add to Framer"}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}

        {items.length > 0 && (
          <div className="queue-footer">
            <span>
              {completedCount} of {selectedItems.length} selected ready
            </span>
            <button
              className="text-button"
              type="button"
              onClick={() => setAllSelected(false)}
              disabled={isCompressing || selectedItems.length === 0}
            >
              Clear selection
            </button>
          </div>
        )}
      </section>

      <section className="controls-panel" aria-label="Compression settings">
        <div className="section-heading">
          <span>COMPRESSION SETTINGS</span>
          <span className="setting-note">{format === "png" ? "LOSSLESS" : "LOSSY"}</span>
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
            <label htmlFor="page-quality-slider">Image quality</label>
            <strong>{format === "png" ? "N/A" : `${quality}%`}</strong>
          </div>
          <input
            id="page-quality-slider"
            type="range"
            className="quality-slider"
            min={0}
            max={100}
            value={quality}
            disabled={format === "png" || isCompressing}
            onChange={(e) => setQuality(Number(e.target.value))}
          />
          <div className="slider-captions">
            <span>Smaller file</span>
            <span>Higher detail</span>
          </div>
          {format === "png" && (
            <p className="quality-help">PNG is lossless, so the quality slider does not apply.</p>
          )}
        </div>

        {settingsChanged && (
          <p className="outdated-note">Settings changed. Compress again to update your results.</p>
        )}

        <button
          className="primary-button"
          type="button"
          onClick={() => void handleCompress()}
          disabled={isCompressing || selectedItems.length === 0}
        >
          {isCompressing ? (
            <>
              <span className="spinner" />
              Compressing selection…
            </>
          ) : (
            <>
              {completedCount > 0 ? "Re-compress selection" : "Compress selection"}
              <span aria-hidden="true">→</span>
            </>
          )}
        </button>

        <p className="framer-note">
          Select the images you want, compress them, then download or add the result to your canvas. Your original layers are never changed.
        </p>
      </section>

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
    </>
  )
}