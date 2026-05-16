import * as vscode from 'vscode';
import * as path from 'path';
import { buildPdfWebviewHtml } from './pdfWebview';

/**
 * Custom editor for `.pdf` files. Replaces VS Code's default "binary file"
 * warning with the same PDF.js-based viewer used by the LaTeX preview panel.
 *
 * Registered as the default editor for *.pdf via `contributes.customEditors`
 * in package.json. Users can still pick another viewer via the
 * "Reopen Editor With…" command.
 */
class PdfDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}
  dispose(): void { /* nothing to release */ }
}

export class PdfCustomEditorProvider
  implements vscode.CustomReadonlyEditorProvider<PdfDocument>
{
  public static readonly viewType = 'latexStudio.pdfEditor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): PdfDocument {
    return new PdfDocument(uri);
  }

  async resolveCustomEditor(
    document: PdfDocument,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    const pdfPath = document.uri.fsPath;
    const pdfDir = path.dirname(pdfPath);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.computeRoots(pdfDir)
    };
    panel.iconPath = vscode.Uri.file(
      path.join(this.context.extensionPath, 'media', 'icon.svg')
    );
    panel.webview.html = buildPdfWebviewHtml(panel.webview, pdfPath);

    // Auto-refresh when the PDF on disk changes (e.g. after a rebuild).
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(pdfDir, path.basename(pdfPath))
    );
    const reload = () => {
      const url = `${panel.webview.asWebviewUri(document.uri).toString()}?v=${Date.now()}`;
      panel.webview.postMessage({ type: 'reload', url });
    };
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);

    panel.webview.onDidReceiveMessage((msg: { type?: string; message?: unknown }) => {
      if (msg && msg.type === 'error') {
        vscode.window.showErrorMessage(
          `LaTeX Studio PDF viewer: ${String(msg.message ?? 'unknown error')}`
        );
      }
    });

    panel.onDidDispose(() => watcher.dispose());
  }

  private computeRoots(pdfDir: string): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
      vscode.Uri.file(pdfDir)
    ];
    for (const f of vscode.workspace.workspaceFolders ?? []) roots.push(f.uri);
    return roots;
  }
}
