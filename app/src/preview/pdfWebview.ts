import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Build the webview HTML that renders a PDF using PDF.js. Shared between
 * the side-by-side LaTeX preview panel and the .pdf custom editor.
 *
 * The `pdfPath` may be null (preview panel only) to render an empty
 * "build to see a PDF" placeholder.
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
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>LaTeX Preview</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
  #toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 10; }
  #toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 8px; cursor: pointer; border-radius: 2px; font-size: 13px; }
  #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #toolbar .spacer { flex: 1; }
  #pages { padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .page { box-shadow: 0 2px 8px rgba(0,0,0,0.3); background: white; display: block; }
  .page.invert { filter: invert(1) hue-rotate(180deg); }
  #empty { padding: 24px; opacity: 0.7; }
  #status { font-size: 12px; opacity: 0.75; min-width: 80px; text-align: right; }
</style>
</head>
<body>
<div id="toolbar">
  <button id="zoom-out" title="Zoom out">−</button>
  <span id="zoom-label">${Math.round(scale * 100)}%</span>
  <button id="zoom-in" title="Zoom in">+</button>
  <button id="fit-width" title="Fit width">Fit</button>
  <button id="invert" title="Invert colors">${invert ? '☀' : '🌙'}</button>
  <div class="spacer"></div>
  <span id="status"></span>
</div>
<div id="pages">
  ${pdfUri ? '' : '<div id="empty">No PDF yet. Build with <b>Ctrl+Alt+B</b>.</div>'}
</div>
<script type="module" nonce="${nonce}">
  import * as pdfjsLib from '${pdfJs}';
  pdfjsLib.GlobalWorkerOptions.workerSrc = '${pdfWorker}';

  const vscode = acquireVsCodeApi();
  let currentUrl = ${JSON.stringify(pdfUri)};
  let scale = ${scale};
  let invert = ${invert ? 'true' : 'false'};
  let pdfDoc = null;

  const pagesEl = document.getElementById('pages');
  const statusEl = document.getElementById('status');
  const zoomLabel = document.getElementById('zoom-label');

  async function load(url) {
    if (!url) return;
    try {
      statusEl.textContent = 'Loading…';
      const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false });
      pdfDoc = await loadingTask.promise;
      await renderAll();
      statusEl.textContent = pdfDoc.numPages + ' pages';
    } catch (err) {
      statusEl.textContent = 'Error';
      vscode.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  }

  async function renderAll() {
    if (!pdfDoc) return;
    const prevScroll = window.scrollY;
    pagesEl.innerHTML = '';
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: scale * dpr });
      const wrap = document.createElement('div');
      wrap.className = 'page-wrap';
      wrap.dataset.page = String(i);
      wrap.style.position = 'relative';
      wrap.style.width = (viewport.width / dpr) + 'px';
      wrap.style.height = (viewport.height / dpr) + 'px';
      const canvas = document.createElement('canvas');
      canvas.className = 'page' + (invert ? ' invert' : '');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      wrap.appendChild(canvas);
      pagesEl.appendChild(wrap);
      const ctx = canvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: ctx, viewport }).promise;
      wrap.dataset.ptToPx = String((viewport.height / dpr) / page.getViewport({ scale: 1 }).height);
    }
    window.scrollTo({ top: prevScroll });
  }

  function flashHighlight(hit) {
    const wrap = pagesEl.querySelector('.page-wrap[data-page="' + hit.page + '"]');
    if (!wrap) return;
    const ptToPx = parseFloat(wrap.dataset.ptToPx || '1');
    const overlay = document.createElement('div');
    overlay.className = 'synctex-flash';
    overlay.style.position = 'absolute';
    overlay.style.left   = Math.max(0, (hit.x - 4) * ptToPx) + 'px';
    overlay.style.top    = Math.max(0, (hit.y - hit.height) * ptToPx) + 'px';
    overlay.style.width  = Math.max(20, (hit.width + 8) * ptToPx) + 'px';
    overlay.style.height = Math.max(10, (hit.height + 6) * ptToPx) + 'px';
    overlay.style.background = 'rgba(255, 213, 79, 0.55)';
    overlay.style.border = '2px solid rgba(255, 152, 0, 0.95)';
    overlay.style.borderRadius = '3px';
    overlay.style.pointerEvents = 'none';
    overlay.style.transition = 'opacity 0.8s ease-out';
    wrap.appendChild(overlay);
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { overlay.style.opacity = '0'; }, 1200);
    setTimeout(() => { overlay.remove(); }, 2200);
  }

  document.getElementById('zoom-in').onclick = () => { scale = Math.min(3, scale + 0.1); zoomLabel.textContent = Math.round(scale*100)+'%'; renderAll(); };
  document.getElementById('zoom-out').onclick = () => { scale = Math.max(0.5, scale - 0.1); zoomLabel.textContent = Math.round(scale*100)+'%'; renderAll(); };
  document.getElementById('fit-width').onclick = async () => {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(1);
    const v = page.getViewport({ scale: 1 });
    const target = (pagesEl.clientWidth - 32) / v.width;
    scale = Math.max(0.5, Math.min(3, target));
    zoomLabel.textContent = Math.round(scale*100)+'%';
    renderAll();
  };
  document.getElementById('invert').onclick = (e) => {
    invert = !invert;
    e.currentTarget.textContent = invert ? '☀' : '🌙';
    for (const c of pagesEl.querySelectorAll('canvas')) c.classList.toggle('invert', invert);
  };

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
