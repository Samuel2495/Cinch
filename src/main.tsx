
import "@framer/plugin/framer.css"

import React from "react"
import ReactDOM from "react-dom/client"
import { framer } from "@framer/plugin"
import { App } from "./App.tsx"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Root element not found")
}

// Explicitly open the Framer plugin window.
framer.showUI({
  position: "top right",
  width: 360,
  height: 600,
  resizable: "height",
})

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
