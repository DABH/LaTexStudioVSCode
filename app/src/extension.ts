import * as vscode from 'vscode';
import * as fs from 'fs';
import { Builder } from './build/builder';
import { PreviewManager } from './preview/previewPanel';
import { PdfCustomEditorProvider } from './preview/pdfCustomEditor';
import {
  ensureEngineAvailable,
  downloadWithProgress,
  isEngineInstalled,
  resetAllData
} from './engine/engineSetup';
import { registerCompletion } from './language/completion';
import { forwardSearch } from './preview/synctex';
import { resolveRootTex, resolveOutputDir, expectedPdfPath, finalPdfPath } from './build/rootResolver';

let builder: Builder;
let preview: PreviewManager;
let output: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let engineStatus: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('LaTeX Studio');
  diagnostics = vscode.languages.createDiagnosticCollection('latex');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = 'latexStudio.build';
  status.tooltip = 'LaTeX Studio: build PDF';
  status.text = '$(file-pdf) LaTeX';
  status.show();

  // Separate status item that only appears when the engine is missing.
  engineStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  engineStatus.command = 'latexStudio.downloadEngine';
  refreshEngineStatus(context);

  builder = new Builder(context, output, diagnostics, status);
  preview = new PreviewManager(context);

  // Auto-open / refresh the preview after a successful build.
  builder.onBuildComplete((result) => {
    if (!result.ok) return;
    const cfg = vscode.workspace.getConfiguration('latexStudio');
    const openOnBuild = cfg.get<boolean>('preview.openOnBuild', true);
    if (openOnBuild) {
      preview.show(result.pdfPath, /* toSide */ true);
    }
    preview.refresh(result.pdfPath);
    refreshEngineStatus(context);
  });

  // Auto-build on save.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== 'latex') return;
      const cfg = vscode.workspace.getConfiguration('latexStudio');
      if (!cfg.get<boolean>('build.onSave', true)) return;
      void builder.requestBuild(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('latexStudio.build', () => builder.requestBuild()),
    vscode.commands.registerCommand('latexStudio.showPreview', () =>
      preview.show(currentPdfForActiveEditor(), /* toSide */ false)
    ),
    vscode.commands.registerCommand('latexStudio.showPreviewToSide', () =>
      preview.show(currentPdfForActiveEditor(), /* toSide */ true)
    ),
    vscode.commands.registerCommand('latexStudio.forwardSearch', () => doForwardSearch()),
    vscode.commands.registerCommand('latexStudio.clean', () => doClean()),
    vscode.commands.registerCommand('latexStudio.openLog', () => output.show(true)),
    vscode.commands.registerCommand('latexStudio.downloadEngine', async () => {
      await downloadWithProgress(context, output);
      refreshEngineStatus(context);
    }),
    vscode.commands.registerCommand('latexStudio.resetAllData', async () => {
      await resetAllData(context, output);
      refreshEngineStatus(context);
    })
  );

  registerCompletion(context);

  // Custom editor so clicking a .pdf in the Explorer opens our preview
  // instead of VS Code's "binary file" warning.
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      PdfCustomEditorProvider.viewType,
      new PdfCustomEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      }
    )
  );

  context.subscriptions.push(
    output,
    diagnostics,
    status,
    engineStatus,
    { dispose: () => builder.dispose() },
    { dispose: () => preview.dispose() }
  );

  // First-run welcome: explain uninstall hygiene once.
  void showFirstRunWelcomeIfNeeded(context);

  // Always re-check engine on activation; prompt if missing.
  void ensureEngineAvailable(context, output).then(() => refreshEngineStatus(context));
}

export function deactivate(): void {
  // VS Code automatically deletes the extension folder on uninstall (which
  // includes our bundled Tectonic binary). Tectonic's user-level package
  // cache lives outside the extension dir and must be removed via the
  // "LaTeX Studio: Reset Everything" command before uninstalling. There is
  // no reliable VS Code API hook for uninstall itself.
}

/** Update or hide the "engine missing" status bar pill. */
function refreshEngineStatus(context: vscode.ExtensionContext): void {
  if (!engineStatus) return;
  if (isEngineInstalled(context)) {
    engineStatus.hide();
  } else {
    engineStatus.text = '$(warning) LaTeX engine missing';
    engineStatus.tooltip = 'Click to download the Tectonic engine';
    engineStatus.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    engineStatus.show();
  }
}

async function showFirstRunWelcomeIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  const KEY = 'latexStudio.welcomeShown.v1';
  if (context.globalState.get<boolean>(KEY)) return;
  await context.globalState.update(KEY, true);
  const choice = await vscode.window.showInformationMessage(
    'Welcome to LaTeX Studio! Before uninstalling, run "LaTeX Studio: Reset Everything" to also delete the Tectonic engine and its downloaded package cache (VS Code does not auto-clean those).',
    'Got it',
    'Show the command'
  );
  if (choice === 'Show the command') {
    await vscode.commands.executeCommand('workbench.action.quickOpen', '>LaTeX Studio: Reset');
  }
}

/**
 * Compute the expected PDF path for the active editor's document, even if it
 * hasn't been built yet (so the preview can show a "build to see PDF" state).
 */
function currentPdfForActiveEditor(): string | null {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || doc.languageId !== 'latex') return null;
  const root = resolveRootTex(doc);
  const sidecar = finalPdfPath(root);
  if (fs.existsSync(sidecar)) return sidecar;
  const outDir = resolveOutputDir(root);
  const pdf = expectedPdfPath(root, outDir);
  return fs.existsSync(pdf) ? pdf : null;
}

async function doForwardSearch(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'latex') {
    vscode.window.showWarningMessage('LaTeX Studio: open a .tex file to use forward search.');
    return;
  }
  const line = editor.selection.active.line;
  const hit = await forwardSearch(editor.document, line);
  if (!hit) {
    vscode.window.showInformationMessage(
      'LaTeX Studio: no SyncTeX match. Build the document first (Ctrl+Alt+B).'
    );
    return;
  }
  const pdf = currentPdfForActiveEditor();
  if (pdf) preview.show(pdf, /* toSide */ true);
  preview.jumpTo(hit);
}

async function doClean(): Promise<void> {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || doc.languageId !== 'latex') {
    vscode.window.showWarningMessage('LaTeX Studio: open a .tex file to clean its build directory.');
    return;
  }
  const root = resolveRootTex(doc);
  const outDir = resolveOutputDir(root);
  const confirm = await vscode.window.showWarningMessage(
    `Delete all build artifacts in ${outDir}?`,
    { modal: true },
    'Delete'
  );
  if (confirm !== 'Delete') return;
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    output.appendLine(`✔ Cleaned ${outDir}`);
    vscode.window.showInformationMessage('LaTeX Studio: build directory cleaned.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`LaTeX Studio: clean failed — ${msg}`);
  }
}
