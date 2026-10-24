# Cinch image-compressor MVP — overlay package

This ZIP is designed to be extracted into the root of your **already-working Framer plugin scaffold**. It deliberately does not replace `package.json`, `framer.json`, `vite.config.ts`, `index.html`, or `src/main.tsx`.

## Files included

- `src/App.tsx` — Cinch UI and Framer canvas actions
- `src/App.css` — self-contained UI styling
- `src/compression.ts` — local browser-canvas image encoder

## Install into your project

1. Stop the development server with `Ctrl+C`.
2. Extract this ZIP into the root of your generated `cinch` project folder (the same folder that contains `package.json`).
3. Allow the two `src` files to be added/replaced when prompted. The archive also adds `src/compression.ts`.
4. Restart the plugin:

   ```powershell
   npm run dev
   ```

5. Open the development plugin in Framer.

The generated scaffold should already depend on the current `@framer/plugin` package. If your `package.json` instead contains only the older `framer-plugin` package, stop here and tell me; do not install both packages blindly.

## MVP workflow

1. Drop an image into Cinch or click the upload area to choose one.
2. Select WebP, JPEG, or PNG.
3. Set quality for WebP/JPEG (PNG is lossless and does not use the quality slider).
4. Click **Compress image**.
5. Review the original and optimized file sizes, then download the result or click **Add to Framer**.

The compression/encoding step runs inside the browser using its built-in Canvas encoders. It makes no external compression-service requests. Clicking **Add to Framer** deliberately passes the already-compressed `File` to Framer's Plugin API; Framer adds it as a new image on the canvas. It does not replace the source layer in this MVP.

## Current limitations

- One local image at a time; no bulk targeting yet.
- Browser-native Canvas encoders rather than the planned dedicated WASM codecs.
- WebP and JPEG quality controls; PNG output is lossless and may be larger than the source.
- No AVIF output, downscaling, filters, background removal, named presets, CMS/page/project scanning, or video support yet.
- **Add to Framer** adds a new canvas image; it does not replace an existing selected image.

If an output is larger than its source, Cinch reports that rather than claiming a saving. Some formats may not be encodable in all browsers; the app checks the actual output MIME type and displays an error if the requested format is unsupported.
