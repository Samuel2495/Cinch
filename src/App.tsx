import { useEffect, useRef, useState } from "react"
import { framer } from "@framer/plugin"
import {
  compressImage,
  formatBytes,
  outputFilename,
  type OutputFormat,
} from "./compression"
import "./App.css"

type ResultSettings = {
  format: OutputFormat
  quality: number
}

const FORMAT_OPTIONS: { value: OutputFormat; label: string; detail: string }[] = [
  { value: "webp", label: "WebP", detail: "Smaller files" },
  { value: "jpeg", label: "JPEG", detail: "Photographs" },
  { value: "png", label: "PNG", detail: "Lossless" },
]

function getSavings(originalSize: number, compressedSize: number) {
  if (originalSize <= 0) return { amount: 0, percent: 0, larger: false }
  const amount = originalSize - compressedSize
  return {
    amount: Math.abs(amount),
    percent: Math.abs((amount / originalSize) * 100),
    larger: amount < 0,
  }
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M7 8.5h18v5H7zM7 18.5h11v5H7z" fill="currentColor" />
        <path d="m21 17 5 4-5 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function formatLabel(format: OutputFormat) {
  return format === "jpeg" ? "JPEG" : format.toUpperCase()
}

export  function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null)
  const [compressedUrl, setCompressedUrl] = useState<string | null>(null)
  const [format, setFormat] = useState<OutputFormat>("webp")
  const [quality, setQuality] = useState(82)
  const [resultSettings, setResultSettings] = useState<ResultSettings | null>(null)
  const [isCompressing, setIsCompressing] = useState(false)
  const [isAddingToFramer, setIsAddingToFramer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl)
    }
  }, [originalUrl])

  useEffect(() => {
    return () => {
      if (compressedUrl) URL.revokeObjectURL(compressedUrl)
    }
  }, [compressedUrl])

  const resultIsCurrent = Boolean(
    compressedBlob &&
      resultSettings &&
      resultSettings.format === format &&
      (format === "png" || resultSettings.quality === quality),
  )

  const savings = compressedBlob && originalFile
    ? getSavings(originalFile.size, compressedBlob.size)
    : null

  function resetResult() {
    setCompressedBlob(null)
    setCompressedUrl(null)
    setResultSettings(null)
  }

  function loadFile(file?: File) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file, such as PNG, JPEG, or WebP.")
      setStatus(null)
      return
    }

    setOriginalFile(file)
    setOriginalUrl(URL.createObjectURL(file))
    resetResult()
    setError(null)
    setStatus(null)
  }

  async function handleCompress() {
    if (!originalFile) return
    setIsCompressing(true)
    setError(null)
    setStatus(null)

    try {
      const result = await compressImage(originalFile, format, quality)
      setCompressedBlob(result.blob)
      setCompressedUrl(URL.createObjectURL(result.blob))
      setResultSettings({ format, quality })
      const nextSavings = getSavings(originalFile.size, result.blob.size)
      setStatus(
        nextSavings.larger
          ? "This export is larger than the original. Try WebP or a lower quality."
          : "Image optimized locally and ready to use.",
      )
    } catch (compressionError) {
      setError(
        compressionError instanceof Error
          ? compressionError.message
          : "Compression failed. Please try another image.",
      )
      resetResult()
    } finally {
      setIsCompressing(false)
    }
  }

  function handleDownload() {
    if (!compressedBlob || !originalFile || !resultIsCurrent) return
    const url = URL.createObjectURL(compressedBlob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = outputFilename(originalFile.name, format)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus("Download started.")
  }

  async function handleAddToFramer() {
    if (!compressedBlob || !originalFile || !resultIsCurrent) return
    setIsAddingToFramer(true)
    setError(null)
    setStatus(null)

    try {
      const filename = outputFilename(originalFile.name, format)
      const optimizedFile = new File([compressedBlob], filename, {
        type: compressedBlob.type,
        lastModified: Date.now(),
      })

      // This API call is only made after the user explicitly clicks this button.
      // Encoding itself has already happened locally in the browser.
      await framer.addImage({
        image: optimizedFile,
        name: filename,
        altText: originalFile.name.replace(/\.[^/.]+$/, ""),
      })
      setStatus("Optimized image added to your Framer canvas.")
    } catch (addError) {
      setError(
        addError instanceof Error
          ? `Could not add the image to Framer: ${addError.message}`
          : "Could not add the image to Framer. Try downloading it instead.",
      )
    } finally {
      setIsAddingToFramer(false)
    }
  }

  const settingsChanged = Boolean(compressedBlob && !resultIsCurrent)

  return (
    <div className="cinch-app">
      <header className="cinch-header">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <div className="brand-name">CINCH TEST<span>.</span></div>
            <div className="brand-caption">IMAGE OPTIMIZER</div>
          </div>
        </div>
        <div className="local-pill"><span className="local-dot" /> LOCAL</div>
      </header>

      <main className="cinch-main">
        <div className="intro-kicker"><span /> THE LIGHTER SIDE OF DESIGN</div>
        <h1>Less weight.<br /><span>Same impact.</span></h1>
        <p className="intro-copy">Make images lighter before they land in your project.</p>

        {!originalFile ? (
          <label
            className={`dropzone${dragging ? " dropzone-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              loadFile(event.dataTransfer.files?.[0])
            }}
          >
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/*"
              onChange={(event) => {
                loadFile(event.currentTarget.files?.[0])
                event.currentTarget.value = ""
              }}
            />
            <div className="upload-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </div>
            <strong>Drop an image here</strong>
            <span className="dropzone-sub">or <span className="inline-link">browse files</span></span>
            <span className="format-hint">PNG · JPG · WEBP · other browser-supported images</span>
          </label>
        ) : (
          <section className="selected-file">
            <div className="file-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke="currentColor" strokeWidth="1.5" /><circle cx="9" cy="9" r="1.7" fill="currentColor" /><path d="m5 17 5-5 3 3 2-2 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="selected-file-meta">
              <strong title={originalFile.name}>{originalFile.name}</strong>
              <span>{formatBytes(originalFile.size)} <span className="dot-separator">·</span> Ready to optimize</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Choose a different image"
              aria-label="Choose a different image"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/*"
              onChange={(event) => {
                loadFile(event.currentTarget.files?.[0])
                event.currentTarget.value = ""
              }}
            />
          </section>
        )}

        {originalFile && originalUrl && (
          <>
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
                  disabled={format === "png"}
                  onChange={(event) => setQuality(Number(event.currentTarget.value))}
                />
                <div className="slider-captions"><span>Smaller file</span><span>Higher detail</span></div>
                {format === "png" && <p className="quality-help">PNG is lossless, so the quality slider does not apply.</p>}
              </div>
              <button className="primary-button" type="button" onClick={handleCompress} disabled={isCompressing}>
                {isCompressing ? <><span className="spinner" /> Compressing image…</> : <>{compressedBlob ? "Re-compress image" : "Compress image"}<span aria-hidden="true">↗</span></>}
              </button>
            </section>

            {compressedBlob && compressedUrl && (
              <section className="results-panel" aria-label="Compression results">
                <div className="section-heading result-heading">
                  <span>BEFORE / AFTER</span>
                  {savings && (
                    <span className={`savings-chip${savings.larger ? " savings-larger" : ""}`}>
                      {savings.larger ? `${savings.percent.toFixed(1)}% larger` : `−${savings.percent.toFixed(1)}%`}
                    </span>
                  )}
                </div>
                <div className="preview-grid">
                  <div className="preview-card">
                    <div className="preview-image-wrap"><img src={originalUrl} alt="Original image preview" /></div>
                    <div className="preview-info"><span>ORIGINAL</span><strong>{formatBytes(originalFile.size)}</strong></div>
                  </div>
                  <div className="preview-card preview-card-after">
                    <div className="preview-image-wrap"><img src={compressedUrl} alt="Compressed image preview" /></div>
                    <div className="preview-info"><span>{formatLabel(format)}</span><strong>{formatBytes(compressedBlob.size)}</strong></div>
                  </div>
                </div>
                {settingsChanged && <p className="outdated-note">Settings changed. Compress again to update this result.</p>}
                {savings && !savings.larger && (
                  <div className="saving-summary"><span className="saving-check">✓</span><span><strong>{formatBytes(savings.amount)} saved</strong> from the original file</span></div>
                )}
                <div className="result-actions">
                  <button className="secondary-button" type="button" onClick={handleDownload} disabled={!resultIsCurrent}>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Download
                  </button>
                  <button className="primary-button add-button" type="button" onClick={handleAddToFramer} disabled={!resultIsCurrent || isAddingToFramer}>
                    {isAddingToFramer ? <><span className="spinner spinner-dark" /> Adding…</> : <>Add to Framer <span aria-hidden="true">↗</span></>}
                  </button>
                </div>
                <p className="framer-note">“Add to Framer” places a new optimized image on the canvas; it does not replace the source layer.</p>
              </section>
            )}
          </>
        )}

        {error && <div className="feedback feedback-error" role="alert"><span>!</span>{error}</div>}
        {status && !error && <div className={`feedback${savings?.larger ? " feedback-warn" : ""}`} role="status"><span>{savings?.larger ? "↗" : "✓"}</span>{status}</div>}

        <footer className="privacy-note">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <span><strong>Your images stay yours.</strong> Compression runs locally. No external compression service.</span>
        </footer>
      </main>
    </div>
  )
}
