# LaTeX Studio — Technical Design

Technical design of the **LaTeX Studio** VS Code extension: high-quality LaTeX → PDF compilation with a live, real-PDF preview.

## Goals & non-goals

**Goals**

- Compile any `.tex` file to PDF from inside VS Code, on command or on save.
- Side-by-side live preview of the *actual* compiled PDF (no HTML approximation).
- Maximum PDF fidelity: vector text, embedded fonts, correct math, working hyperlinks/bookmarks, optional PDF/A.
- Zero prerequisites — no system TeX install required.
- SyncTeX forward/inverse search between editor and preview.

**Non-goals**

- A WYSIWYG editor.
- An HTML/MathJax/KaTeX approximation of the document (diverges from the final PDF; cannot represent floats, page breaks, microtype, or bibliography).
- A full TeX distribution manager (Tectonic handles package fetching itself).

## Architecture

```
┌────────────────────────┐     ┌────────────────────────────┐
│ VS Code Extension Host │     │  LaTeX Engine (subprocess) │
│ (TypeScript)           │────▶│  tectonic / latexmk+xelatex│
│  • Commands            │     └────────────────────────────┘
│  • Editor decorations  │                │
│  • SyncTeX bridge      │                ▼
│  • File watcher        │     ┌────────────────────────────┐
│  • Webview manager     │◀─── │  out/main.pdf + .synctex   │
└──────────┬─────────────┘     └────────────────────────────┘
           │ postMessage
           ▼
┌────────────────────────┐
│ Webview (PDF preview)  │
│  PDF.js viewer         │
│  • zoom / search       │
│  • SyncTeX highlight   │
└────────────────────────┘
```

Three processes are involved:

1. **Extension host** (Node, TypeScript) — owns commands, the build queue, diagnostics, the file watcher, and the webview lifecycle.
2. **LaTeX engine subprocess** — Tectonic (default) or `latexmk` driving `xelatex` / `lualatex` / `pdflatex`.
3. **Webview** (Chromium) — PDF.js viewer; communicates with the host via `postMessage`.

## Component design

### Engine layer (`app/src/engine/`)

- `tectonic.ts` — builds the argument vector and spawns Tectonic with `shell: false`.
- `engineSetup.ts` — resolves the engine path (user override → bundled binary → `PATH`); handles first-run download into `app/bin/`.

Engine selection is user-configurable via `latexStudio.engine`:

| Engine | When to use |
|---|---|
| `tectonic` (default, bundled) | Best out-of-box, modern Unicode/OTF math, auto-fetches packages |
| `xelatex` + `latexmk` | User has TeX Live and needs custom system fonts/packages |
| `lualatex` + `latexmk` | Heavy programmatic typesetting, microtype Pro |
| `pdflatex` + `latexmk` | Legacy classes, fastest compile |

Default invocation flags:

- Tectonic: `--synctex --keep-logs --keep-intermediates -o <outdir> <root>`.
- `pdflatex` family: `-synctex=1 -interaction=nonstopmode -file-line-error -shell-escape=restricted`.

Rationale for Tectonic as default: single static binary per OS (Win/macOS/Linux), auto-fetches required CTAN packages into a local cache, built on XeTeX (Unicode + system fonts + OpenType math), handles multi-pass + biber/bibtex without external glue, and emits clean PDF 1.5 with embedded vector fonts.

### Build layer (`app/src/build/`)

- `rootResolver.ts` — finds the project root via `% !TEX root = …` magic comment (TeXShop / LaTeX Workshop compatible), falling back to the active file.
- `builder.ts` — debounced, single-flight build queue. New triggers cancel the in-flight build.
- `logParser.ts` — parses engine log output into `vscode.Diagnostic[]` with file + line + severity, published to the Problems panel.

### Preview layer (`app/src/preview/`)

- `previewPanel.ts` — owns the `WebviewPanel`. Hosts a PDF.js shell; on rebuild, posts the new PDF URI (with a cache-busting query) so PDF.js re-renders only changed pages while preserving scroll position.
- `synctex.ts` — forward/inverse search bridge.

PDF.js renders the *actual* compiled PDF at `window.devicePixelRatio`, capped at 3× for sharp HiDPI without runaway memory. It provides text selection, search, zoom, thumbnails, and outline.

### Language layer (`app/src/language/`)

- `completion.ts` — IntelliSense providers for `\ref`, `\cite`, and `\includegraphics` paths.
- Static contributions: `snippets/latex.json`, `language-configuration.json`.

## Build pipeline

1. Resolve the root `.tex` (magic comment → active file).
2. Compute output dir: `<root-dir>/<latexStudio.build.outputDirectory>` (default `.latex-build`, gitignore-friendly).
3. Spawn the engine with the flags above; stream stdout/stderr to the output channel.
4. Parse the log → publish diagnostics.
5. On success, post `{ pdfUri, version }` to the webview; PDF.js diff-renders.
6. If `latexStudio.preview.openOnBuild` is set and no preview is open, open one to the side.

Trigger sources:

- Manual: `latexStudio.build` command (`Ctrl+Alt+B`).
- `onDidSaveTextDocument` when `latexStudio.build.onSave` is true.

## SyncTeX

- **Forward** (editor → PDF): `synctex view -i "${line}:${col}:${tex}" -o main.pdf` → page + rectangle → webview highlights the region.
- **Inverse** (PDF → editor): Ctrl+Click in the webview → page + (x, y) → `synctex edit -o "main.pdf:${page}:${x}:${y}"` → open file at line.

## Feature surface

Capabilities the design must support:

- **Build**: `latexStudio.build` command + keybinding, auto-build on save, output channel, Problems-panel diagnostics from the log parser.
- **Preview**: real-PDF preview in a webview with zoom, fit-to-width, page navigation, dark/invert mode, render-scale setting.
- **Engine bootstrap**: `latexStudio.downloadEngine` command; postinstall script for development.
- **Project model**: multi-file projects via `% !TEX root = …`; biber/bibtex picked up automatically by Tectonic.
- **SyncTeX**: `latexStudio.forwardSearch` (`Ctrl+Alt+J`) + Ctrl+Click inverse.
- **Authoring aids**: snippets for common environments; completion for `\ref`, `\cite`, `\includegraphics`.
- **Status surface**: status-bar item showing engine, last build duration, error count.
- **Quality tooling**: warn on raster `\includegraphics` < 300 DPI; font-embedding audit on the produced PDF; PDF/A-2b export via `\usepackage[a-2b]{pdfx}`; optional `qpdf --linearize` post-pass.
- **Lifecycle**: `latexStudio.clean` (purge build artifacts), `latexStudio.resetAllData` (pre-uninstall reset).

## `package.json` contributions

- `contributes.languages`: `latex` with extensions `.tex / .ltx / .sty / .cls`.
- `contributes.commands`: `latexStudio.build`, `latexStudio.showPreview`, `latexStudio.showPreviewToSide`, `latexStudio.forwardSearch`, `latexStudio.clean`, `latexStudio.openLog`, `latexStudio.downloadEngine`, `latexStudio.resetAllData`.
- `contributes.keybindings`: `ctrl+alt+b` (build), `ctrl+k v` (preview to side, mirrors Markdown), `ctrl+alt+j` (forward search). All gated on `editorLangId == latex`.
- `contributes.menus.editor/title`: preview + build icons when `resourceLangId == latex`.
- `contributes.configuration`:
  - `latexStudio.engine`: `tectonic | xelatex | lualatex | pdflatex`
  - `latexStudio.tectonicPath`: override path to a `tectonic` executable
  - `latexStudio.build.onSave`: bool (default `true`)
  - `latexStudio.build.outputDirectory`: string (default `.latex-build`)
  - `latexStudio.preview.invertColors`: bool
  - `latexStudio.preview.renderScale`: number, 0.5–3 (default 1.5)
  - `latexStudio.preview.openOnBuild`: bool (default `true`)

## Repository layout

```
LatexStudio/
├── README.md
├── Design.md                      # this file
├── .vscode/                       # debug/build tasks for working on the extension
└── app/                           # the VS Code extension itself
    ├── package.json
    ├── language-configuration.json
    ├── snippets/latex.json
    ├── sample/main.tex            # tiny .tex used for the Extension Development Host
    ├── scripts/
    │   ├── download-tectonic.js   # postinstall: fetch correct binary per OS/arch
    │   └── build-icon.js
    ├── media/                     # icon + (future) webview assets
    └── src/
        ├── extension.ts           # activate(), command registration
        ├── engine/
        │   ├── tectonic.ts        # spawn + arg builder
        │   └── engineSetup.ts     # downloader + path resolution
        ├── build/
        │   ├── builder.ts         # debounce, queue, cancel
        │   ├── logParser.ts       # → vscode.Diagnostic[]
        │   └── rootResolver.ts    # %!TEX root, magic comments
        ├── preview/
        │   ├── previewPanel.ts    # WebviewPanel lifecycle + PDF.js shell
        │   └── synctex.ts         # forward/inverse via `synctex view`/`edit`
        └── language/
            └── completion.ts      # \cite, \ref, file paths
```

## Security

- **Webview**: `enableScripts: true` with a strict CSP; `localResourceRoots` limited to the build directory and `media/`. The PDF is served via `asWebviewUri`.
- **Engine subprocess**: `shell: false`, arguments passed as an array, `shell-escape` restricted by default. A separate setting can opt into `--shell-escape` with a clear warning.
- **Engine download**: the Tectonic binary is verified against a pinned SHA-256 manifest before first use.

## Performance

- Debounced, single-flight build queue (cancel in-flight on new trigger).
- Incremental compilation: Tectonic caches packages; `latexmk` uses `.fls` / `.fdb_latexmk` for dependency tracking.
- PDF.js renders pages lazily and virtualizes scroll.
- Preview reloads diff only the pages whose content hash changed, preserving scroll position.

## Testing strategy

- **Unit**: `logParser`, `rootResolver`, SyncTeX coordinate math.
- **Integration**: launch the extension host against `app/sample/main.tex`, assert that a PDF is produced and that the preview round-trips a message.
- **Visual regression**: render page 1 to PNG and compare against a baseline (pixelmatch) to guard against quality regressions.
