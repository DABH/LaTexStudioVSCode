# LaTeX Studio

**Write LaTeX in VS Code. See a beautiful PDF the moment you save.**

LaTeX Studio turns VS Code into a complete LaTeX authoring environment — no TeX install, no command line, no extra setup. Open a `.tex` file, press `Ctrl+K V`, and start writing. The real, compiled PDF appears next to your editor and refreshes automatically every time you save.

---

## ⚡ 60-second quick start

1. Install **LaTeX Studio** from the Marketplace.
2. Open any `.tex` file.
3. Press `Ctrl+Alt+B` (Build).
4. The first time only, you'll be prompted to download the LaTeX engine — click **Download**. ☕ (~30 MB, one-time)
5. Press `Ctrl+K V` to open the PDF preview to the side.
6. Save the file. The PDF updates automatically.

That's it. No `texlive`, no MiKTeX, no `latexmk` config.

---

## 📦 What gets installed (please read once)

LaTeX Studio is small on its own, but LaTeX itself is big. To keep the extension lightweight, the actual LaTeX engine and packages are downloaded **on first use**, not bundled with the extension.

| When | What happens | Size | Where it lives |
|---|---|---|---|
| **Install the extension** | Nothing is downloaded. | ~35 KB | VS Code extensions folder |
| **First build** *(one-time prompt)* | Downloads the [Tectonic](https://tectonic-typesetting.github.io/) engine binary for your OS. | ~30 MB | `<extension>/bin/tectonic[.exe]` |
| **First time a document uses a package** | Tectonic fetches it from [CTAN](https://ctan.org/) automatically and caches it. | varies | Per-user cache (see below) |
| **Subsequent builds** | Fully offline. No further downloads. | 0 | — |

**Internet is required** for the first build *and* whenever your document references a LaTeX package you haven't used before. After that, builds work fully offline. Nothing is uploaded — no telemetry, no accounts, no documents leave your machine.

### Where the cache lives

| OS | Tectonic package cache |
|---|---|
| Windows | `%LOCALAPPDATA%\TectonicProject` |
| macOS | `~/Library/Caches/Tectonic` |
| Linux | `~/.cache/Tectonic` |

To wipe everything LaTeX Studio created — engine binary, package cache, extension state — run **`LaTeX Studio: Reset Everything (Before Uninstall)`** from the Command Palette.

### Behind a corporate proxy or firewall?

If the first-run download fails, you have two options:

- **Set a system proxy** so Node/HTTPS can reach `github.com` and `ctan.org`, then re-run **`LaTeX: Download/Update Tectonic Engine`**.
- **Use a LaTeX distribution you already have** (TeX Live / MiKTeX). Set `latexStudio.engine` to `xelatex`, `lualatex`, or `pdflatex` — LaTeX Studio will use that instead, and nothing extra gets downloaded.

---

## ✨ Features

### 📄 Real, live PDF preview
A side-by-side webview shows the *actual* compiled PDF — rendered by [PDF.js](https://mozilla.github.io/pdf.js/). Floats, page breaks, math, microtypography, and hyperlinks all look exactly like the final document. Scroll position is preserved between builds.

### 💾 Build on save
Auto-rebuild fires every time you save (toggle off with `latexStudio.build.onSave`). All output goes into a single `.latex-build/` folder you can `.gitignore`.

### ❌ Errors in the right place
The build log is parsed into VS Code's **Problems** panel with file and line numbers, so failures click straight back to the offending line. Full log via **LaTeX: Show Build Log**.

### 📚 Multi-file projects
Drop a magic comment at the top of any sub-file and LaTeX Studio always compiles the right root:

```tex
% !TEX root = ../main.tex
```

### 📖 Bibliographies that just work
Tectonic detects `biber` / `bibtex` automatically and runs the right number of passes. No `latexmk` config to babysit.

### ⌨️ Snippets & completion
Snippets: `doc-article`, `sec`, `ssec`, `fig`, `tab`, `eq`, `align`, `itemize`, `enumerate`, `env`, `texroot`. Completion for `\ref`, `\cite`, and `\includegraphics` paths.

### 🌙 Dark mode
Toggle `latexStudio.preview.invertColors` for an inverted PDF — easy on the eyes for late-night writing.

---

## 🎮 Commands & keybindings

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "LaTeX":

| Command | Keybinding (Win/Linux) | Keybinding (macOS) |
|---|---|---|
| LaTeX: Build PDF | `Ctrl+Alt+B` | `Cmd+Alt+B` |
| LaTeX: Open Preview to the Side | `Ctrl+K V` | `Cmd+K V` |
| LaTeX: Open Preview (active editor) | — | — |
| LaTeX: Jump to PDF (SyncTeX Forward Search) | `Ctrl+Alt+J` | `Cmd+Alt+J` |
| LaTeX: Show Build Log | — | — |
| LaTeX: Clean Build Artifacts | — | — |
| LaTeX: Download/Update Tectonic Engine | — | — |
| LaTeX Studio: Reset Everything (Before Uninstall) | — | — |

---

## ⚙️ Settings

All settings live under `latexStudio.*` (open **Settings** → search "LaTeX Studio").

| Setting | Default | What it does |
|---|---|---|
| `latexStudio.engine` | `tectonic` | Engine to compile with: `tectonic`, `xelatex`, `lualatex`, or `pdflatex`. |
| `latexStudio.tectonicPath` | _(empty)_ | Path to a Tectonic executable to use instead of the bundled one. |
| `latexStudio.build.onSave` | `true` | Rebuild the PDF every time you save a `.tex` file. |
| `latexStudio.build.outputDirectory` | `.latex-build` | Where compiled PDFs and intermediates go (relative to the root `.tex`). |
| `latexStudio.preview.invertColors` | `false` | Dark mode for the PDF preview. |
| `latexStudio.preview.renderScale` | `1.5` | Preview render scale, `0.5`–`3.0`. Higher = sharper, uses more memory. |
| `latexStudio.preview.openOnBuild` | `true` | Open the preview after your first successful build. |

---

## 🔧 Bring your own LaTeX

Already have TeX Live, MiKTeX, or MacTeX installed and don't want a second engine?

1. Open Settings, search for `latexStudio.engine`.
2. Set it to `xelatex`, `lualatex`, or `pdflatex`.
3. Make sure that binary (and `latexmk`) is on your `PATH`.

LaTeX Studio will drive your existing engine and **nothing extra is downloaded**.

You can also pin a specific Tectonic binary via `latexStudio.tectonicPath` (absolute path to the executable).

---

## 🆘 Troubleshooting

<details>
<summary><strong>"Tectonic engine not found" / first build never starts</strong></summary>

Run **`LaTeX: Download/Update Tectonic Engine`** from the Command Palette. Check the Output panel (**View → Output → LaTeX Studio**) for the download URL and any HTTP errors. Most failures here are corporate proxies — see the proxy section above.
</details>

<details>
<summary><strong>Build hangs the first time a document uses a new package</strong></summary>

Tectonic is fetching the package from CTAN in the background. Subsequent builds use the local cache and are instant. Watch the Output panel for progress.
</details>

<details>
<summary><strong>"Could not find root file"</strong></summary>

You're building a sub-file in a multi-file project. Add a magic comment at the top:
```tex
% !TEX root = ../main.tex
```
</details>

<details>
<summary><strong>Preview is blurry</strong></summary>

Increase `latexStudio.preview.renderScale` (try `2.0` or `2.5`).
</details>

<details>
<summary><strong>I want to start from a clean slate / fully uninstall</strong></summary>

Run **`LaTeX Studio: Reset Everything (Before Uninstall)`** *before* uninstalling the extension. This removes the bundled engine, Tectonic's package cache, and extension state.
</details>

---

## 🔒 Privacy

- **No telemetry.** Nothing is sent anywhere.
- **No accounts.** No sign-in, ever.
- **Network use is strictly:** GitHub (engine download, one time) and CTAN (LaTeX packages, on demand). Both are initiated by *you*, by building.
- Your documents and PDFs never leave your computer.

---

## 📜 License

See the repository for license terms.
