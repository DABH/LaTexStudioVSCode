# LaTeX Studio

**Write LaTeX in VS Code. See a beautiful PDF the moment you save.**

LaTeX Studio turns VS Code into a complete LaTeX authoring environment — no TeX install, no command line, no extra setup. Open a `.tex` file, press `Ctrl+K V`, and start writing. The real, compiled PDF appears next to your editor and refreshes automatically every time you save.

---

## Why LaTeX Studio

- **Zero setup.** The first time you build, LaTeX Studio downloads a self-contained [Tectonic](https://tectonic-typesetting.github.io/) engine for your OS. You never have to install TeX Live or MiKTeX, and you never have to manage packages — Tectonic fetches what your document needs on demand.
- **What you see is what you ship.** The preview shows the *actual* compiled PDF rendered by [PDF.js](https://mozilla.github.io/pdf.js/) — not an HTML approximation. Floats, page breaks, microtypography, math, bibliography, and hyperlinks all look exactly like the final document.
- **Publication-quality output.** Built on the XeTeX engine for full Unicode, system fonts, and OpenType math. Fonts are embedded as vector subsets and PDFs come out clean and print-ready.
- **Feels like Markdown preview.** Same keybindings (`Ctrl+K V`), same side-by-side workflow, same auto-refresh-on-save. If you can use Markdown preview, you already know how to use this.
- **Stays out of your way.** Errors and warnings land in the Problems panel with file + line numbers. The build log is one click away in the Output panel. Build artifacts live in a single `.latex-build/` folder you can `.gitignore`.

## Quick start

1. Install **LaTeX Studio** from the VS Code Marketplace.
2. Open any `.tex` file.
3. Press `Ctrl+K V` (macOS: `Cmd+K V`) to open the preview to the side.
4. Press `Ctrl+Alt+B` to build — or just save. That's it.

> **First-run heads-up:** the first time you build, you'll see a one-time prompt to download the LaTeX engine (~30 MB). Click **Download** and grab a coffee — it's a one-shot setup. Builds after that are fast and offline. If you'd rather use a TeX distribution you already have installed, see [Bring your own engine](#bring-your-own-engine) below.

## What gets installed, and when

LaTeX Studio is deliberately small. The actual LaTeX toolchain is downloaded on demand so the extension stays lightweight.

| When | What happens | Size | Notes |
|---|---|---|---|
| Install the extension | Nothing extra is downloaded | ~35 KB | Pure JS, ships from the Marketplace |
| **First build** *(one-time prompt)* | Downloads the [Tectonic](https://tectonic-typesetting.github.io/) engine for your OS | ~30 MB | Stored inside the extension folder |
| First time a document uses a LaTeX package | Tectonic fetches it from [CTAN](https://ctan.org/) and caches it locally | varies | Per-user cache, reused across projects |
| Subsequent builds | Fully offline | 0 | No network access |

Behind a corporate proxy or air-gapped? Either configure a system proxy so the first-run downloads can reach `github.com` and `ctan.org`, or set `latexStudio.engine` to `xelatex` / `lualatex` / `pdflatex` to use an existing TeX install instead — nothing extra will be downloaded in that case.

## What you get

### A real, live PDF preview

A side-by-side webview shows the actual compiled PDF. Scroll, zoom, fit-to-width, search inside the PDF, and toggle a dark/inverted mode for night writing. The preview re-renders only the pages that changed, so your scroll position is preserved between builds.

### Build on save (or on demand)

Auto-rebuild fires every time you save (toggle off if you prefer). All output — the PDF, log, and intermediates — goes into `.latex-build/` next to your root `.tex`.

### Real errors, in the right place

The build log is parsed into VS Code's **Problems** panel with file and line numbers, so failures click straight back to the offending line. The full log is always available via **LaTeX: Show Build Log**.

### Multi-file projects

Working in a folder with a `main.tex` and a bunch of chapter files? Drop a magic comment at the top of any sub-file and LaTeX Studio will always compile the right root:

```tex
% !TEX root = ../main.tex
```

This is the same convention used by TeXShop and LaTeX Workshop, so existing projects just work.

### Bibliographies that just work

Tectonic detects `biber`/`bibtex` automatically and runs the right number of passes — no `latexmk` config to babysit.

### Authoring aids

Snippets for the things you type all day: `doc-article`, `sec`, `ssec`, `fig`, `tab`, `eq`, `align`, `itemize`, `enumerate`, `env`, `texroot`. Completion suggestions for `\ref`, `\cite`, and `\includegraphics` file paths.

### SyncTeX (coming soon)

- **Forward search** — `Ctrl+Alt+J` jumps the preview to your cursor position.
- **Inverse search** — `Ctrl+Click` anywhere in the PDF jumps the editor to that source line.

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type "LaTeX":

| Command                                       | Keybinding   |
| --------------------------------------------- | ------------ |
| LaTeX: Build PDF                              | `Ctrl+Alt+B` |
| LaTeX: Open Preview to the Side               | `Ctrl+K V`   |
| LaTeX: Jump to PDF (SyncTeX Forward Search)   | `Ctrl+Alt+J` |
| LaTeX: Clean Build Artifacts                  | —            |
| LaTeX: Show Build Log                         | —            |
| LaTeX: Download/Update Tectonic Engine        | —            |
| LaTeX Studio: Reset Everything (Before Uninstall) | —        |

## Settings

All settings live under `latexStudio.*` in your VS Code settings.

| Setting | Default | What it does |
|---|---|---|
| `latexStudio.engine` | `tectonic` | Engine to compile with: `tectonic`, `xelatex`, `lualatex`, or `pdflatex`. |
| `latexStudio.tectonicPath` | _(empty)_ | Path to a Tectonic executable to use instead of the bundled one. |
| `latexStudio.build.onSave` | `true` | Rebuild the PDF every time you save a `.tex` file. |
| `latexStudio.build.outputDirectory` | `.latex-build` | Where compiled PDFs and intermediates go (relative to the root `.tex`). |
| `latexStudio.preview.invertColors` | `false` | Dark mode for the PDF preview. |
| `latexStudio.preview.renderScale` | `1.5` | Preview render scale, `0.5`–`3.0`. Higher is sharper but uses more memory. |
| `latexStudio.preview.openOnBuild` | `true` | Open the preview to the side after your first successful build. |

## Bring your own engine

Prefer the TeX distribution you already have? Set `latexStudio.engine` to `xelatex`, `lualatex`, or `pdflatex`. LaTeX Studio will drive it via `latexmk` if available. You can also point `latexStudio.tectonicPath` at a Tectonic binary you maintain yourself.

## Privacy & network use

- On first build, LaTeX Studio downloads the official Tectonic binary from its GitHub releases page.
- Tectonic itself downloads any LaTeX packages your document references from CTAN, into a local cache on your machine.
- No telemetry. No accounts. Your documents never leave your computer.

## Uninstalling

Run **LaTeX Studio: Reset Everything (Before Uninstall)** before removing the extension. That command cleans up the downloaded engine and cached state.

## Project & design

This repository contains the extension source under [`app/`](app/). For the architecture and technical design, see [Design.md](Design.md).

## License

See [LICENSE](LICENSE) (if present in this repository) or the marketplace listing for license terms.
