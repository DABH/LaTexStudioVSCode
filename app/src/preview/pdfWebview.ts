import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Build the webview HTML that renders a PDF using PDF.js, styled to closely
 * resemble the default PDF.js viewer shipped with Firefox.
 *
 * Features parity targets:
 *   - Dark "Firefox" toolbar with sidebar toggle, find, page nav, zoom presets
 *   - Sidebar with Thumbnails and Outline tabs
 *   - Text-selection layer (real selectable text)
 *   - Find bar with prev/next / match case / highlight all / status counter
 *   - Page-aware scroll tracking
 *   - SyncTeX highlight overlay (preserved from previous implementation)
 */
export function buildPdfWebviewHtml(
  webview: vscode.Webview,
  pdfPath: string | null
): string {
  const nonce = makeNonce();
  const cfg = vscode.workspace.getConfiguration('latexStudio');
  const invert = !!cfg.get<boolean>('preview.invertColors', false);
  const scale = Number(cfg.get<number>('preview.renderScale', 1.5)) || 1.5;

  const pdfUri = pdfPath && fs.existsSync(pdfPath)
    ? `${webview.asWebviewUri(vscode.Uri.file(pdfPath)).toString()}?v=${Date.now()}`
    : '';

  const pdfJs = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs';
  const pdfWorker = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} https: data:`,
    `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    `connect-src ${webview.cspSource} https: blob: data:`,
    `worker-src blob: ${webview.cspSource}`
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>LaTeX Preview</title>
<style>
  /* ---------- Firefox PDF.js look-alike theme ---------- */
  :root {
    --toolbar-bg: #2a2a2e;
    --toolbar-bg-grad: linear-gradient(180deg, #3a3a3e 0%, #2a2a2e 100%);
    --toolbar-fg: #e8e8ec;
    --toolbar-border: #0f0f10;
    --toolbar-hover: rgba(255,255,255,0.08);
    --toolbar-active: rgba(255,255,255,0.14);
    --toolbar-separator: rgba(255,255,255,0.12);
    --sidebar-bg: #2f2f33;
    --sidebar-fg: #e8e8ec;
    --sidebar-hover: rgba(255,255,255,0.06);
    --sidebar-selected: rgba(10,132,255,0.18);
    --viewer-bg: #525659;
    --page-shadow: 0 2px 10px rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.4);
    --find-bar-bg: #38383d;
    --accent: #0a84ff;
    --not-found: #c50e2e;
    --input-bg: #1c1c1f;
    --input-border: #0a0a0b;
  }

  html, body {
    margin: 0; padding: 0; height: 100%; width: 100%;
    background: var(--viewer-bg);
    color: var(--toolbar-fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, sans-serif;
    font-size: 12px;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* ---------- Layout ---------- */
  #outerContainer {
    display: grid;
    grid-template-rows: auto 1fr;
    grid-template-columns: 0 1fr;
    height: 100%;
    width: 100%;
    transition: grid-template-columns 0.18s ease-out;
  }
  #outerContainer.sidebarOpen {
    grid-template-columns: 220px 1fr;
  }
  #toolbarContainer {
    grid-row: 1; grid-column: 1 / 3;
    z-index: 20;
  }
  #sidebarContainer {
    grid-row: 2; grid-column: 1;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--toolbar-border);
    overflow: hidden;
    display: flex; flex-direction: column;
    min-width: 0;
  }
  #viewerContainer {
    grid-row: 2; grid-column: 2;
    overflow: auto;
    position: relative;
    background: var(--viewer-bg);
  }

  /* ---------- Toolbar ---------- */
  #toolbar {
    display: flex;
    align-items: center;
    height: 34px;
    padding: 0 6px;
    background: var(--toolbar-bg-grad);
    border-bottom: 1px solid var(--toolbar-border);
    color: var(--toolbar-fg);
    user-select: none;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,0.25), 0 1px 0 rgba(0,0,0,0.3);
  }
  .toolbarButton {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 26px; height: 24px; padding: 0 5px;
    background: transparent; color: var(--toolbar-fg);
    border: 1px solid transparent; border-radius: 3px;
    cursor: pointer; font-size: 13px;
    margin: 0 1px;
    transition: background 80ms ease, border-color 80ms ease;
  }
  .toolbarButton:hover { background: var(--toolbar-hover); border-color: rgba(255,255,255,0.10); }
  .toolbarButton:active, .toolbarButton.toggled { background: var(--toolbar-active); border-color: rgba(255,255,255,0.16); box-shadow: inset 0 1px 2px rgba(0,0,0,0.3); }
  .toolbarButton[disabled] { opacity: 0.35; cursor: default; }
  .toolbarButton[disabled]:hover { background: transparent; border-color: transparent; }
  .toolbarButton svg {
    width: 16px; height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .toolbarButton svg.filled { fill: currentColor; stroke: none; }

  .splitToolbarButton { display: inline-flex; }
  .splitToolbarButton .toolbarButton { margin: 0; border-radius: 0; }
  .splitToolbarButton .toolbarButton:first-child { border-radius: 3px 0 0 3px; }
  .splitToolbarButton .toolbarButton:last-child  { border-radius: 0 3px 3px 0; }
  .splitToolbarButton .toolbarButton + .toolbarButton { border-left: 1px solid rgba(0,0,0,0.35); }

  .verticalToolbarSeparator {
    display: inline-block;
    width: 1px; height: 20px;
    background: var(--toolbar-separator);
    margin: 0 6px;
  }

  #toolbarViewerLeft, #toolbarViewerRight, #toolbarViewerMiddle {
    display: flex; align-items: center;
  }
  #toolbarViewerLeft { flex: 0 0 auto; }
  #toolbarViewerMiddle { flex: 1 1 auto; justify-content: center; }
  #toolbarViewerRight { flex: 0 0 auto; }

  #pageNumber {
    width: 42px; height: 22px;
    background: var(--input-bg); color: var(--toolbar-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    text-align: right; padding: 0 5px;
    font-size: 12px;
    margin: 0 2px 0 4px;
    -moz-appearance: textfield;
    box-shadow: inset 0 1px 1px rgba(0,0,0,0.4);
  }
  #pageNumber::-webkit-outer-spin-button,
  #pageNumber::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  #pageNumber:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  #numPages { padding: 0 6px; opacity: 0.8; font-variant-numeric: tabular-nums; }

  #scaleSelectContainer { display: inline-block; margin: 0 2px; position: relative; }
  #scaleSelect {
    background: var(--input-bg); color: var(--toolbar-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    height: 22px; padding: 0 22px 0 8px;
    font-size: 12px; min-width: 130px;
    cursor: pointer;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' fill='none' stroke='%23e8e8ec' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>");
    background-repeat: no-repeat;
    background-position: right 6px center;
    box-shadow: inset 0 1px 1px rgba(0,0,0,0.4);
  }
  #scaleSelect:hover { border-color: #2a2a2c; }
  #scaleSelect:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  #scaleSelect option { background: #2a2a2e; color: var(--toolbar-fg); }

  /* ---------- Sidebar ---------- */
  #sidebarHeader {
    display: flex; align-items: center;
    height: 32px;
    background: linear-gradient(180deg, #38383d 0%, #2a2a2e 100%);
    border-bottom: 1px solid var(--toolbar-border);
    padding: 0 4px;
    box-shadow: inset 0 -1px 0 rgba(0,0,0,0.25);
  }
  #sidebarHeader .toolbarButton { flex: 1 1 0; min-width: 0; }
  #sidebarContent { flex: 1; overflow: auto; padding: 8px; }

  #thumbnailView { display: flex; flex-direction: column; gap: 10px; align-items: center; }
  .thumbnail {
    position: relative; cursor: pointer;
    border: 1px solid transparent; padding: 4px;
    border-radius: 3px;
    transition: background 80ms ease;
  }
  .thumbnail:hover { background: var(--sidebar-hover); }
  .thumbnail.selected { background: var(--sidebar-selected); border-color: var(--accent); }
  .thumbnail canvas { display: block; box-shadow: 0 1px 4px rgba(0,0,0,0.7); background: #fff; border-radius: 1px; }
  .thumbnailLabel { text-align: center; font-size: 11px; opacity: 0.75; margin-top: 4px; font-variant-numeric: tabular-nums; }

  #outlineView { font-size: 12px; }
  #outlineView ul { list-style: none; padding-left: 14px; margin: 0; }
  #outlineView > ul { padding-left: 4px; }
  #outlineView li { margin: 1px 0; }
  #outlineView a {
    color: var(--sidebar-fg); text-decoration: none;
    display: block; padding: 3px 6px; border-radius: 3px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #outlineView a:hover { background: var(--sidebar-hover); }
  #outlineEmpty, #thumbnailEmpty { opacity: 0.55; padding: 14px; text-align: center; font-style: italic; }

  .sidebarTab[hidden] { display: none; }

  /* ---------- Find bar ---------- */
  #findbar {
    position: absolute;
    top: 35px; left: 6px;
    background: var(--find-bar-bg);
    border: 1px solid var(--toolbar-border);
    border-top: none;
    padding: 7px 9px;
    display: none;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.45);
    border-radius: 0 0 4px 4px;
    z-index: 25;
  }
  #findbar.visible { display: flex; }
  #findInput {
    background: var(--input-bg); color: var(--toolbar-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    width: 220px; height: 24px; padding: 0 8px;
    box-shadow: inset 0 1px 1px rgba(0,0,0,0.4);
  }
  #findInput.notFound { background: #5d1a23; border-color: #8a2031; }
  #findInput:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  #findbar label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; padding: 0 2px; }
  #findbar input[type="checkbox"] { accent-color: var(--accent); }
  #findStatus { opacity: 0.85; min-width: 100px; font-size: 11px; padding-left: 4px; }

  /* ---------- Pages / viewer ---------- */
  #viewer {
    padding: 12px 0 36px;
    display: flex; flex-direction: column; align-items: center;
    gap: 12px;
  }
  .page {
    position: relative;
    background: white;
    box-shadow: var(--page-shadow);
    margin: 0 auto;
    overflow: hidden;
  }
  .page.invert > canvas { filter: invert(1) hue-rotate(180deg); }
  .page canvas { display: block; }

  /* PDF.js text layer styles */
  .textLayer {
    position: absolute;
    text-align: initial;
    inset: 0;
    overflow: clip;
    opacity: 1;
    line-height: 1;
    -webkit-text-size-adjust: none;
    -moz-text-size-adjust: none;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    caret-color: #000;
    z-index: 2;
  }
  .textLayer :is(span, br) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
  }
  .textLayer span.highlight { background: rgba(180, 0, 170, 0.25); border-radius: 1px; }
  .textLayer span.highlight.selected { background: rgba(0, 100, 0, 0.35); }
  .textLayer ::selection { background: rgba(0, 100, 255, 0.3); }

  #empty {
    color: var(--toolbar-fg);
    padding: 40px;
    text-align: center;
    opacity: 0.85;
    font-size: 14px;
  }
  #empty kbd {
    background: var(--toolbar-bg);
    border: 1px solid var(--toolbar-border);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: ui-monospace, Consolas, monospace;
  }

  /* Loading bar */
  #loadingBar {
    position: absolute; top: 0; left: 0; height: 2px;
    width: 0%; background: var(--accent);
    transition: width 0.2s linear;
    z-index: 30;
  }

  /* SyncTeX flash */
  .synctex-flash {
    position: absolute;
    background: rgba(255, 213, 79, 0.55);
    border: 2px solid rgba(255, 152, 0, 0.95);
    border-radius: 3px;
    pointer-events: none;
    transition: opacity 0.8s ease-out;
    z-index: 3;
  }
</style>
</head>
<body>
<div id="outerContainer">
  <div id="toolbarContainer">
    <div id="toolbar">
      <div id="toolbarViewerLeft">
        <button id="sidebarToggle" class="toolbarButton" title="Toggle Sidebar" aria-label="Toggle Sidebar">
          <svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.2"/><line x1="6" y1="3" x2="6" y2="13"/></svg>
        </button>
        <div class="verticalToolbarSeparator"></div>
        <button id="viewFind" class="toolbarButton" title="Find in document (Ctrl+F)" aria-label="Find">
          <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.2"/><line x1="10.2" y1="10.2" x2="13.4" y2="13.4"/></svg>
        </button>
        <div class="verticalToolbarSeparator"></div>
        <div class="splitToolbarButton">
          <button id="previous" class="toolbarButton" title="Previous Page" aria-label="Previous Page">
            <svg viewBox="0 0 16 16"><polyline points="10.5,3.5 5.5,8 10.5,12.5"/></svg>
          </button>
          <button id="next" class="toolbarButton" title="Next Page" aria-label="Next Page">
            <svg viewBox="0 0 16 16"><polyline points="5.5,3.5 10.5,8 5.5,12.5"/></svg>
          </button>
        </div>
        <input id="pageNumber" type="number" value="1" min="1" aria-label="Page Number" />
        <span id="numPages">of 0</span>
      </div>

      <div id="toolbarViewerMiddle">
        <div class="splitToolbarButton">
          <button id="zoomOut" class="toolbarButton" title="Zoom Out" aria-label="Zoom Out">
            <svg viewBox="0 0 16 16"><line x1="3.5" y1="8" x2="12.5" y2="8"/></svg>
          </button>
          <button id="zoomIn" class="toolbarButton" title="Zoom In" aria-label="Zoom In">
            <svg viewBox="0 0 16 16"><line x1="3.5" y1="8" x2="12.5" y2="8"/><line x1="8" y1="3.5" x2="8" y2="12.5"/></svg>
          </button>
        </div>
        <span id="scaleSelectContainer">
          <select id="scaleSelect" aria-label="Zoom">
            <option value="auto">Automatic Zoom</option>
            <option value="page-actual">Actual Size</option>
            <option value="page-fit">Page Fit</option>
            <option value="page-width">Page Width</option>
            <option disabled>──────</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
            <option value="3">300%</option>
            <option value="4">400%</option>
          </select>
        </span>
      </div>

      <div id="toolbarViewerRight">
        <button id="invertToggle" class="toolbarButton" title="Invert Colors (Dark Mode)" aria-label="Invert Colors">
          <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path class="halfFill" d="M8 2.5 A 5.5 5.5 0 0 1 8 13.5 Z" fill="currentColor" stroke="none"/></svg>
        </button>
      </div>
    </div>

    <div id="findbar">
      <input id="findInput" type="text" placeholder="Find in document…" />
      <button id="findPrev" class="toolbarButton" title="Previous" aria-label="Previous match">
        <svg viewBox="0 0 16 16"><polyline points="4,10 8,6 12,10"/></svg>
      </button>
      <button id="findNext" class="toolbarButton" title="Next" aria-label="Next match">
        <svg viewBox="0 0 16 16"><polyline points="4,6 8,10 12,6"/></svg>
      </button>
      <label><input id="findHighlightAll" type="checkbox" />Highlight All</label>
      <label><input id="findMatchCase" type="checkbox" />Match Case</label>
      <span id="findStatus"></span>
      <button id="findClose" class="toolbarButton" title="Close" aria-label="Close">
        <svg viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
      </button>
    </div>
  </div>

  <div id="sidebarContainer">
    <div id="sidebarHeader">
      <button id="viewThumbnail" class="toolbarButton toggled" title="Show Thumbnails" aria-label="Show Thumbnails">
        <svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="9" width="4.5" height="4.5" rx="0.5"/></svg>
      </button>
      <button id="viewOutline" class="toolbarButton" title="Show Document Outline" aria-label="Show Outline">
        <svg viewBox="0 0 16 16"><line x1="3" y1="4" x2="3.01" y2="4"/><line x1="6" y1="4" x2="13" y2="4"/><line x1="3" y1="8" x2="3.01" y2="8"/><line x1="6" y1="8" x2="13" y2="8"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="6" y1="12" x2="13" y2="12"/></svg>
      </button>
    </div>
    <div id="sidebarContent">
      <div id="thumbnailView" class="sidebarTab"></div>
      <div id="outlineView" class="sidebarTab" hidden><div id="outlineEmpty">No outline available.</div></div>
    </div>
  </div>

  <div id="viewerContainer">
    <div id="loadingBar"></div>
    <div id="viewer">
      ${pdfUri ? '' : '<div id="empty">No PDF yet. Build with <kbd>Ctrl+Alt+B</kbd>.</div>'}
    </div>
  </div>
</div>

<script type="module" nonce="${nonce}">
  import * as pdfjsLib from '${pdfJs}';
  pdfjsLib.GlobalWorkerOptions.workerSrc = '${pdfWorker}';

  const vscode = acquireVsCodeApi();

  // View state persisted across webview recreation (window reload, tab
  // close/reopen). Consumed once by the first load(); live reloads use the
  // in-context capture in load() instead.
  let restoredStateOnce = (typeof vscode.getState === 'function' && vscode.getState()) || null;

  // --- State -----------------------------------------------------------------
  let currentUrl   = ${JSON.stringify(pdfUri)};
  let pdfDoc       = null;
  let numPages     = 0;
  let currentPage  = 1;
  let invert       = ${invert ? 'true' : 'false'};
  let scaleMode    = 'auto';                  // 'auto' | 'page-fit' | 'page-width' | 'page-actual' | number
  let currentScale = ${scale};                // numeric, in CSS units (1 == 72 DPI nominal)
  let pageViews    = [];                      // { wrap, canvas, textLayerDiv, viewport, page, pdfPage, rendered }
  let renderQueue  = Promise.resolve();
  let outline      = null;
  let destinations = new Map();               // page index -> array of {dest, label}
  let loadGen      = 0;                       // bumped on each load(); guards races
  if (restoredStateOnce && typeof restoredStateOnce.scaleMode !== 'undefined' && restoredStateOnce.scaleMode !== null) {
    scaleMode = restoredStateOnce.scaleMode;  // keep the user's zoom across webview recreation
  }

  const DPR = Math.min(window.devicePixelRatio || 1, 3);

  // --- DOM -------------------------------------------------------------------
  const outerContainer  = document.getElementById('outerContainer');
  const viewerContainer = document.getElementById('viewerContainer');
  const viewer          = document.getElementById('viewer');
  const loadingBar      = document.getElementById('loadingBar');

  const sidebarToggle   = document.getElementById('sidebarToggle');
  const viewThumbnail   = document.getElementById('viewThumbnail');
  const viewOutline     = document.getElementById('viewOutline');
  const thumbnailView   = document.getElementById('thumbnailView');
  const outlineView     = document.getElementById('outlineView');

  const prevBtn         = document.getElementById('previous');
  const nextBtn         = document.getElementById('next');
  const pageNumberInput = document.getElementById('pageNumber');
  const numPagesLabel   = document.getElementById('numPages');

  const zoomInBtn       = document.getElementById('zoomIn');
  const zoomOutBtn      = document.getElementById('zoomOut');
  const scaleSelect     = document.getElementById('scaleSelect');
  const invertToggle    = document.getElementById('invertToggle');

  const findBar         = document.getElementById('findbar');
  const findBtn         = document.getElementById('viewFind');
  const findInput       = document.getElementById('findInput');
  const findPrev        = document.getElementById('findPrev');
  const findNext        = document.getElementById('findNext');
  const findHighlightAll= document.getElementById('findHighlightAll');
  const findMatchCase   = document.getElementById('findMatchCase');
  const findStatus      = document.getElementById('findStatus');
  const findClose       = document.getElementById('findClose');

  // --- Loading ---------------------------------------------------------------
  async function load(url) {
    if (!url) return;
    const myGen = ++loadGen;
    // Capture the reading position before teardown: clearing #viewer
    // collapses the scroll container (the browser clamps scrollTop to 0), so
    // without restoring it every rebuild lands back on page 1.
    const prevScrollTop  = viewerContainer.scrollTop;
    const prevScrollLeft = viewerContainer.scrollLeft;
    const prevPage       = currentPage;
    // Tear down any previous document so its workers/pages are released and
    // cannot deliver stale results to the new pageViews array.
    if (pdfDoc) {
      try { await pdfDoc.destroy(); } catch (_) { /* ignore */ }
      pdfDoc = null;
    }
    try {
      loadingBar.style.width = '20%';
      const task = pdfjsLib.getDocument({ url, withCredentials: false });
      task.onProgress = (p) => {
        if (myGen !== loadGen) return;
        const pct = p.total ? Math.max(20, Math.round(100 * p.loaded / p.total)) : 50;
        loadingBar.style.width = pct + '%';
      };
      const doc = await task.promise;
      if (myGen !== loadGen) { try { await doc.destroy(); } catch (_) {} return; }
      pdfDoc = doc;
      numPages = pdfDoc.numPages;
      numPagesLabel.textContent = 'of ' + numPages;
      pageNumberInput.max = String(numPages);

      // Reset views
      viewer.innerHTML = '';
      pageViews = [];

      // Pre-fetch metadata for sizing
      const firstPage = await pdfDoc.getPage(1);
      if (myGen !== loadGen) return;
      const baseViewport = firstPage.getViewport({ scale: 1 });

      // Compute initial scale per mode
      const numericScale = computeScale(baseViewport);

      // Create page placeholders sized to the first page's aspect ratio
      // (we'll resize per page when each renders)
      for (let i = 1; i <= numPages; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'page' + (invert ? ' invert' : '');
        wrap.dataset.pageNumber = String(i);
        wrap.style.width  = (baseViewport.width  * numericScale) + 'px';
        wrap.style.height = (baseViewport.height * numericScale) + 'px';
        viewer.appendChild(wrap);
        pageViews.push({ wrap, canvas: null, textLayerDiv: null, viewport: null, pdfPage: null, rendered: false, rendering: false, gen: myGen });
      }

      currentScale = numericScale;
      updateScaleSelectFromMode();

      // Reset thumbnails sidebar — old thumbnails belong to the old document.
      thumbnailView.innerHTML = '';

      // Restore the reading position. The placeholders above are laid out at
      // the same page size and scale as before the reload, so the captured
      // pixel offsets map to the same spot (assignment clamps automatically
      // if the rebuilt document is shorter). On a fresh webview (window
      // reload / tab reopen) fall back to the state persisted via setState.
      if (prevScrollTop > 0 || prevScrollLeft > 0) {
        viewerContainer.scrollTop  = prevScrollTop;
        viewerContainer.scrollLeft = prevScrollLeft;
        currentPage = Math.max(1, Math.min(prevPage, numPages));
        pageNumberInput.value = String(currentPage);
      } else if (restoredStateOnce && (restoredStateOnce.scrollTop > 0 || restoredStateOnce.scrollLeft > 0)) {
        viewerContainer.scrollTop  = restoredStateOnce.scrollTop  || 0;
        viewerContainer.scrollLeft = restoredStateOnce.scrollLeft || 0;
        currentPage = Math.max(1, Math.min(restoredStateOnce.page || 1, numPages));
        pageNumberInput.value = String(currentPage);
      }
      restoredStateOnce = null;
      saveViewState();

      await renderVisiblePages();
      if (myGen !== loadGen) return;
      buildThumbnails();
      await buildOutline();
      if (myGen !== loadGen) return;

      loadingBar.style.width = '100%';
      setTimeout(() => { if (myGen === loadGen) loadingBar.style.width = '0%'; }, 250);
    } catch (err) {
      if (myGen !== loadGen) return;
      loadingBar.style.width = '0%';
      vscode.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  }

  function computeScale(baseViewport) {
    const availW = viewerContainer.clientWidth  - 24;
    const availH = viewerContainer.clientHeight - 24;
    if (scaleMode === 'page-width')  return availW / baseViewport.width;
    if (scaleMode === 'page-fit')    return Math.min(availW / baseViewport.width, availH / baseViewport.height);
    if (scaleMode === 'page-actual') return 1;
    if (scaleMode === 'auto') {
      // Firefox "Automatic Zoom" picks min(page-width, ~1.0) on narrow viewports
      const w = availW / baseViewport.width;
      return Math.min(w, 1.25);
    }
    return Number(scaleMode) || 1;
  }

  function updateScaleSelectFromMode() {
    if (typeof scaleMode === 'string') {
      scaleSelect.value = scaleMode;
    } else {
      // Pick the closest preset; otherwise show percentage text in a synthetic option
      const presets = ['0.5','0.75','1','1.25','1.5','2','3','4'];
      const s = String(scaleMode);
      if (presets.includes(s)) scaleSelect.value = s;
      else {
        // add a transient custom option
        let opt = scaleSelect.querySelector('option[data-custom="1"]');
        if (!opt) {
          opt = document.createElement('option');
          opt.dataset.custom = '1';
          scaleSelect.appendChild(opt);
        }
        opt.value = s;
        opt.textContent = Math.round(currentScale * 100) + '%';
        scaleSelect.value = s;
      }
    }
  }

  // --- Page rendering --------------------------------------------------------
  async function renderPage(idx) {
    const view = pageViews[idx];
    if (!view || view.rendered || view.rendering) return;
    if (view.gen !== loadGen) return;
    view.rendering = true;
    const myGen = view.gen;
    const doc = pdfDoc;
    if (!view.pdfPage) view.pdfPage = await doc.getPage(idx + 1);
    if (myGen !== loadGen || view !== pageViews[idx]) { view.rendering = false; return; }
    const viewport = view.pdfPage.getViewport({ scale: currentScale });
    view.viewport = viewport;

    view.wrap.style.width  = viewport.width  + 'px';
    view.wrap.style.height = viewport.height + 'px';

    const canvas = document.createElement('canvas');
    canvas.width  = Math.floor(viewport.width  * DPR);
    canvas.height = Math.floor(viewport.height * DPR);
    canvas.style.width  = viewport.width  + 'px';
    canvas.style.height = viewport.height + 'px';
    view.canvas = canvas;
    view.wrap.innerHTML = '';
    view.wrap.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.scale(DPR, DPR);
    try {
      await view.pdfPage.render({ canvasContext: ctx, viewport }).promise;
    } catch (_e) {
      view.rendering = false;
      return;
    }
    if (myGen !== loadGen || view !== pageViews[idx]) { view.rendering = false; return; }

    // Text layer for selection & find
    try {
      const textContent = await view.pdfPage.getTextContent();
      if (myGen !== loadGen || view !== pageViews[idx]) { view.rendering = false; return; }
      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      textLayerDiv.style.width  = viewport.width  + 'px';
      textLayerDiv.style.height = viewport.height + 'px';
      view.wrap.appendChild(textLayerDiv);
      view.textLayerDiv = textLayerDiv;

      if (pdfjsLib.TextLayer) {
        const tl = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport
        });
        await tl.render();
      } else if (pdfjsLib.renderTextLayer) {
        await pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
          textDivs: []
        }).promise;
      }
    } catch (_e) { /* text layer is best-effort */ }

    view.rendered = true;
    view.rendering = false;

    if (findState.query) applyHighlightsToPage(idx);
  }

  async function renderVisiblePages() {
    if (!pdfDoc) return;
    const ct = viewerContainer.scrollTop;
    const cb = ct + viewerContainer.clientHeight;
    const margin = 600;
    const tasks = [];
    for (let i = 0; i < pageViews.length; i++) {
      const w = pageViews[i].wrap;
      const top = w.offsetTop, bot = top + w.offsetHeight;
      if (bot >= ct - margin && top <= cb + margin) {
        tasks.push(renderPage(i));
      } else if (pageViews[i].rendered && (bot < ct - margin * 4 || top > cb + margin * 4)) {
        // free far-away pages to save memory
        unrenderPage(i);
      }
    }
    await Promise.all(tasks);
  }

  function unrenderPage(idx) {
    const v = pageViews[idx];
    if (!v || !v.rendered) return;
    const w = v.wrap;
    const width  = w.style.width;
    const height = w.style.height;
    w.innerHTML = '';
    w.style.width = width;
    w.style.height = height;
    v.canvas = null;
    v.textLayerDiv = null;
    v.rendered = false;
  }

  async function rerenderAll() {
    if (!pdfDoc) return;
    // Reset sizes using base viewport so layout is correct even before render
    for (let i = 0; i < pageViews.length; i++) {
      const v = pageViews[i];
      if (!v.pdfPage) v.pdfPage = await pdfDoc.getPage(i + 1);
      const vp = v.pdfPage.getViewport({ scale: currentScale });
      v.wrap.style.width  = vp.width  + 'px';
      v.wrap.style.height = vp.height + 'px';
      if (v.rendered) unrenderPage(i);
    }
    await renderVisiblePages();
  }

  function queue(fn) {
    renderQueue = renderQueue.then(fn).catch(() => {});
    return renderQueue;
  }

  // --- Scroll tracking -------------------------------------------------------
  // Persist the view state (throttled) so a recreated webview can restore it.
  let saveStateTimer = null;
  function saveViewState() {
    if (typeof vscode.setState !== 'function') return;
    if (saveStateTimer) return;
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      vscode.setState({
        scrollTop: viewerContainer.scrollTop,
        scrollLeft: viewerContainer.scrollLeft,
        page: currentPage,
        scaleMode
      });
    }, 250);
  }

  viewerContainer.addEventListener('scroll', () => {
    queue(renderVisiblePages);
    const ct = viewerContainer.scrollTop + viewerContainer.clientHeight / 3;
    for (let i = 0; i < pageViews.length; i++) {
      const w = pageViews[i].wrap;
      if (w.offsetTop <= ct && w.offsetTop + w.offsetHeight >= ct) {
        if (currentPage !== i + 1) {
          currentPage = i + 1;
          pageNumberInput.value = String(currentPage);
          updateThumbnailSelection();
        }
        break;
      }
    }
    saveViewState();
  }, { passive: true });

  // --- Navigation ------------------------------------------------------------
  function goToPage(n) {
    n = Math.max(1, Math.min(numPages || 1, Math.round(n)));
    currentPage = n;
    pageNumberInput.value = String(n);
    const w = pageViews[n - 1]?.wrap;
    if (w) viewerContainer.scrollTo({ top: w.offsetTop - 8, behavior: 'instant' in viewerContainer ? 'instant' : 'auto' });
    updateThumbnailSelection();
  }
  prevBtn.onclick = () => goToPage(currentPage - 1);
  nextBtn.onclick = () => goToPage(currentPage + 1);
  pageNumberInput.addEventListener('change', () => goToPage(parseInt(pageNumberInput.value, 10)));

  // --- Zoom ------------------------------------------------------------------
  function setScale(mode) {
    scaleMode = mode;
    pdfDoc?.getPage(1).then(p => {
      const base = p.getViewport({ scale: 1 });
      currentScale = computeScale(base);
      updateScaleSelectFromMode();
      queue(rerenderAll);
      saveViewState();
    });
  }
  zoomInBtn.onclick  = () => setScale(String(Math.min(4,   Math.round((currentScale + 0.1) * 100) / 100)));
  zoomOutBtn.onclick = () => setScale(String(Math.max(0.25,Math.round((currentScale - 0.1) * 100) / 100)));
  scaleSelect.onchange = () => setScale(scaleSelect.value);
  invertToggle.onclick = () => {
    invert = !invert;
    invertToggle.classList.toggle('toggled', invert);
    for (const v of pageViews) v.wrap.classList.toggle('invert', invert);
    // Also restyle thumbnails so dark-mode preview is consistent
  };
  if (invert) invertToggle.classList.add('toggled');

  // Ctrl/Meta + wheel zoom. Listen in the capture phase on window so we run
  // before any default browser/VS Code page-zoom behavior, and never let the
  // event scroll the viewer.
  function onWheelZoom(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    // Anchor zoom around mouse position so the document feels stable
    const rect = viewerContainer.getBoundingClientRect();
    const mx = e.clientX - rect.left + viewerContainer.scrollLeft;
    const my = e.clientY - rect.top  + viewerContainer.scrollTop;
    const prevScale = currentScale;

    const step = e.deltaY > 0 ? -0.1 : 0.1;
    const next = Math.max(0.25, Math.min(4, Math.round((currentScale + step) * 100) / 100));
    if (next === currentScale) return;

    setScale(String(next));

    // Re-anchor scroll after layout settles
    requestAnimationFrame(() => {
      const ratio = next / prevScale;
      viewerContainer.scrollLeft = mx * ratio - (e.clientX - rect.left);
      viewerContainer.scrollTop  = my * ratio - (e.clientY - rect.top);
    });
  }
  window.addEventListener('wheel', onWheelZoom, { passive: false, capture: true });
  // Prevent Ctrl+wheel from being interpreted as a zoom gesture by anything else
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  }, { passive: false, capture: true });

  // Window resize re-applies fit modes
  window.addEventListener('resize', () => {
    if (typeof scaleMode === 'string' && scaleMode !== 'page-actual') {
      setScale(scaleMode);
    }
  });

  // --- Sidebar ---------------------------------------------------------------
  let sidebarOpen = false;
  function openSidebar(open) {
    sidebarOpen = open;
    outerContainer.classList.toggle('sidebarOpen', open);
    sidebarToggle.classList.toggle('toggled', open);
    if (open) buildThumbnails();
  }
  sidebarToggle.onclick = () => openSidebar(!sidebarOpen);

  function selectSidebarTab(which) {
    const isThumb = which === 'thumb';
    viewThumbnail.classList.toggle('toggled', isThumb);
    viewOutline.classList.toggle('toggled', !isThumb);
    thumbnailView.hidden = !isThumb;
    outlineView.hidden   =  isThumb;
  }
  viewThumbnail.onclick = () => selectSidebarTab('thumb');
  viewOutline.onclick   = () => selectSidebarTab('outline');

  async function buildThumbnails() {
    if (!pdfDoc || !sidebarOpen) return;
    if (thumbnailView.childElementCount === numPages) return; // already built
    thumbnailView.innerHTML = '';
    for (let i = 1; i <= numPages; i++) {
      const thumb = document.createElement('div');
      thumb.className = 'thumbnail';
      thumb.dataset.pageNumber = String(i);
      thumb.onclick = () => goToPage(i);
      const c = document.createElement('canvas');
      const label = document.createElement('div');
      label.className = 'thumbnailLabel';
      label.textContent = String(i);
      thumb.appendChild(c);
      thumb.appendChild(label);
      thumbnailView.appendChild(thumb);

      // Render thumbnail asynchronously
      (async () => {
        try {
          const page = await pdfDoc.getPage(i);
          const baseVp = page.getViewport({ scale: 1 });
          const targetW = 130;
          const s = targetW / baseVp.width;
          const vp = page.getViewport({ scale: s });
          c.width = Math.floor(vp.width * DPR);
          c.height = Math.floor(vp.height * DPR);
          c.style.width  = vp.width + 'px';
          c.style.height = vp.height + 'px';
          const ctx = c.getContext('2d', { alpha: false });
          ctx.scale(DPR, DPR);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        } catch (_) { /* ignore */ }
      })();
    }
    updateThumbnailSelection();
  }

  function updateThumbnailSelection() {
    const all = thumbnailView.querySelectorAll('.thumbnail');
    all.forEach(t => t.classList.toggle('selected', t.dataset.pageNumber === String(currentPage)));
    const sel = thumbnailView.querySelector('.thumbnail.selected');
    if (sel && sidebarOpen) {
      const r = sel.getBoundingClientRect();
      const pr = thumbnailView.parentElement.getBoundingClientRect();
      if (r.top < pr.top || r.bottom > pr.bottom) sel.scrollIntoView({ block: 'nearest' });
    }
  }

  async function buildOutline() {
    if (!pdfDoc) return;
    outline = await pdfDoc.getOutline();
    outlineView.innerHTML = '';
    if (!outline || !outline.length) {
      const e = document.createElement('div');
      e.id = 'outlineEmpty';
      e.textContent = 'No outline available.';
      outlineView.appendChild(e);
      return;
    }
    const ul = document.createElement('ul');
    outlineView.appendChild(ul);
    await renderOutlineNodes(outline, ul);
  }

  async function renderOutlineNodes(items, parent) {
    for (const it of items) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = it.title || '(untitled)';
      a.onclick = async (e) => {
        e.preventDefault();
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
          if (!dest) return;
          const ref = dest[0];
          const pageIndex = await pdfDoc.getPageIndex(ref);
          goToPage(pageIndex + 1);
        } catch (_) {}
      };
      li.appendChild(a);
      parent.appendChild(li);
      if (it.items && it.items.length) {
        const ul = document.createElement('ul');
        li.appendChild(ul);
        await renderOutlineNodes(it.items, ul);
      }
    }
  }

  // --- Find ------------------------------------------------------------------
  const findState = { query: '', matchCase: false, highlightAll: false, matches: [], current: -1 };

  function showFindBar(show) {
    findBar.classList.toggle('visible', show);
    if (show) { findInput.focus(); findInput.select(); }
  }
  findBtn.onclick   = () => showFindBar(!findBar.classList.contains('visible'));
  findClose.onclick = () => showFindBar(false);

  findInput.addEventListener('input',  () => runFind(0));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.shiftKey ? gotoMatch(-1) : gotoMatch(1); }
    if (e.key === 'Escape') showFindBar(false);
  });
  findPrev.onclick = () => gotoMatch(-1);
  findNext.onclick = () => gotoMatch(1);
  findHighlightAll.onchange = () => { findState.highlightAll = findHighlightAll.checked; refreshHighlights(); };
  findMatchCase.onchange    = () => { findState.matchCase    = findMatchCase.checked;    runFind(0); };

  async function runFind(direction) {
    findState.query = findInput.value || '';
    findState.matches = [];
    findState.current = -1;
    if (!pdfDoc || !findState.query) { findStatus.textContent = ''; findInput.classList.remove('notFound'); refreshHighlights(); return; }

    const needle = findState.matchCase ? findState.query : findState.query.toLowerCase();
    for (let i = 0; i < numPages; i++) {
      const v = pageViews[i];
      if (!v.pdfPage) v.pdfPage = await pdfDoc.getPage(i + 1);
      const tc = await v.pdfPage.getTextContent();
      const text = tc.items.map(it => it.str).join(' ');
      const hay = findState.matchCase ? text : text.toLowerCase();
      let pos = 0;
      while (true) {
        const idx = hay.indexOf(needle, pos);
        if (idx < 0) break;
        findState.matches.push({ page: i });
        pos = idx + needle.length;
      }
    }

    if (findState.matches.length === 0) {
      findInput.classList.add('notFound');
      findStatus.textContent = 'Phrase not found';
    } else {
      findInput.classList.remove('notFound');
      gotoMatch(direction || 1);
    }
    refreshHighlights();
  }

  function gotoMatch(dir) {
    if (!findState.matches.length) return;
    if (findState.current < 0) findState.current = 0;
    else findState.current = (findState.current + dir + findState.matches.length) % findState.matches.length;
    findStatus.textContent = (findState.current + 1) + ' of ' + findState.matches.length + ' matches';
    const m = findState.matches[findState.current];
    goToPage(m.page + 1);
  }

  function refreshHighlights() {
    for (let i = 0; i < pageViews.length; i++) applyHighlightsToPage(i);
  }
  function applyHighlightsToPage(i) {
    const v = pageViews[i];
    if (!v || !v.textLayerDiv) return;
    const spans = v.textLayerDiv.querySelectorAll('span');
    const q = findState.query;
    if (!q || !findState.highlightAll) {
      spans.forEach(s => s.classList.remove('highlight'));
      return;
    }
    const needle = findState.matchCase ? q : q.toLowerCase();
    spans.forEach(s => {
      const t = s.textContent || '';
      const h = findState.matchCase ? t : t.toLowerCase();
      s.classList.toggle('highlight', h.includes(needle));
    });
  }

  // --- Keyboard shortcuts ----------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      showFindBar(true);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
      e.preventDefault(); zoomInBtn.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault(); zoomOutBtn.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault(); setScale('auto');
    } else if (e.key === 'PageDown') {
      e.preventDefault(); goToPage(currentPage + 1);
    } else if (e.key === 'PageUp') {
      e.preventDefault(); goToPage(currentPage - 1);
    } else if (e.key === 'Home' && !e.target.matches('input,select,textarea')) {
      e.preventDefault(); goToPage(1);
    } else if (e.key === 'End' && !e.target.matches('input,select,textarea')) {
      e.preventDefault(); goToPage(numPages);
    }
  });

  // --- SyncTeX flash (preserved from previous implementation) ----------------
  async function flashHighlight(hit) {
    await renderPage(hit.page - 1);
    const view = pageViews[hit.page - 1];
    if (!view) return;
    const wrap = view.wrap;
    const vp   = view.viewport;
    if (!vp) return;
    // SyncTeX coords are in PDF points (1 pt = 1/72 in). The viewport already
    // maps points to CSS pixels at the current scale (viewport.scale).
    const s = vp.scale;
    const overlay = document.createElement('div');
    overlay.className = 'synctex-flash';
    overlay.style.left   = Math.max(0, (hit.x - 4) * s) + 'px';
    overlay.style.top    = Math.max(0, (hit.y - hit.height) * s) + 'px';
    overlay.style.width  = Math.max(20, (hit.width + 8) * s) + 'px';
    overlay.style.height = Math.max(10, (hit.height + 6) * s) + 'px';
    wrap.appendChild(overlay);
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { overlay.style.opacity = '0'; }, 1200);
    setTimeout(() => { overlay.remove(); }, 2200);
  }

  // --- Messaging -------------------------------------------------------------
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'reload' && msg.url) {
      currentUrl = msg.url;
      load(currentUrl);
    } else if (msg.type === 'jumpTo' && msg.hit) {
      flashHighlight(msg.hit);
    }
  });

  vscode.postMessage({ type: 'ready' });
  if (currentUrl) load(currentUrl);
</script>
</body>
</html>`;
}

export function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
