import * as vscode from 'vscode';
import * as path from 'path';
import { buildPdfWebviewHtml } from './pdfWebview';

/**
 * Manages a single side-by-side WebviewPanel that renders the most recently
 * compiled PDF using PDF.js. Behaves like VS Code's built-in Markdown preview.
 */
export class PreviewManager {
  private panel: vscode.WebviewPanel | null = null;
  private currentPdf: string | null = null;
  private viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside;
  private readonly panelDisposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Show the preview, creating the webview if necessary. */
  show(pdfPath: string | null, toSide: boolean): void {
    const column = toSide
      ? vscode.ViewColumn.Beside
      : (vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One);

    // If the PDF lives outside the current panel's allowed roots, recreate.
    if (this.panel && pdfPath && !this.rootsCover(pdfPath)) {
      this.disposePanel();
    }

    if (!this.panel) {
      this.viewColumn = column;
      this.createPanel(pdfPath);
    } else {
      this.panel.reveal(column, true);
    }

    this.currentPdf = pdfPath;
    if (this.panel) {
      this.panel.webview.html = this.renderHtml(pdfPath);
    }
  }

  /** Re-load the PDF in the existing webview (post-build refresh). */
  refresh(pdfPath: string): void {
    if (!this.panel) return;
    if (!this.rootsCover(pdfPath)) {
      this.disposePanel();
      this.createPanel(pdfPath);
      this.currentPdf = pdfPath;
      if (this.panel) {
        (this.panel as vscode.WebviewPanel).webview.html = this.renderHtml(pdfPath);
      }
      return;
    }
    this.currentPdf = pdfPath;
    const uri = this.panel.webview.asWebviewUri(vscode.Uri.file(pdfPath));
    this.panel.webview.postMessage({
      type: 'reload',
      url: `${uri.toString()}?v=${Date.now()}`
    });
  }

  /** Scroll the preview to a SyncTeX hit and flash a highlight rectangle. */
  jumpTo(hit: { page: number; x: number; y: number; width: number; height: number }): void {
    if (!this.panel) return;
    this.panel.webview.postMessage({ type: 'jumpTo', hit });
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside, true);
  }

  private rootsCover(pdfPath: string): boolean {
    const dir = path.dirname(pdfPath);
    for (const root of this.computeLocalRoots(this.currentPdf)) {
      const rp = root.fsPath;
      if (dir === rp || dir.startsWith(rp + path.sep)) return true;
    }
    return false;
  }

  private createPanel(pdfPath: string | null): void {
    const panel = vscode.window.createWebviewPanel(
      'latexStudio.preview',
      'LaTeX Preview',
      { viewColumn: this.viewColumn, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: this.computeLocalRoots(pdfPath)
      }
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.file(
      path.join(this.context.extensionPath, 'media', 'icon.svg')
    );
    this.panelDisposables.push(
      panel.onDidDispose(() => {
        this.panel = null;
        this.currentPdf = null;
        this.disposePanelListeners();
      }),
      panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg))
    );
  }

  private disposePanel(): void {
    if (this.panel) {
      const p = this.panel;
      this.panel = null;
      this.disposePanelListeners();
      p.dispose();
    }
  }

  private disposePanelListeners(): void {
    while (this.panelDisposables.length) {
      const d = this.panelDisposables.pop();
      try { d?.dispose(); } catch { /* ignore */ }
    }
  }

  private computeLocalRoots(pdfPath: string | null): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
    ];
    if (pdfPath) roots.push(vscode.Uri.file(path.dirname(pdfPath)));
    for (const f of vscode.workspace.workspaceFolders ?? []) roots.push(f.uri);
    return roots;
  }

  private handleMessage(msg: { type?: string; message?: unknown }): void {
    if (!msg) return;
    if (msg.type === 'error') {
      vscode.window.showErrorMessage(`LaTeX preview: ${String(msg.message ?? 'unknown error')}`);
    }
  }

  private renderHtml(pdfPath: string | null): string {
    if (!this.panel) return '';
    return buildPdfWebviewHtml(this.panel.webview, pdfPath);
  }

  dispose(): void {
    this.disposePanel();
  }
}
