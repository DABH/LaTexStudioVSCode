import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { resolveTectonicPath } from './tectonic';

/**
 * All filesystem locations the extension manages or creates. Used by the
 * "Reset Everything" command so users can clean up before uninstalling.
 */
export function getManagedPaths(context: vscode.ExtensionContext): {
  label: string;
  path: string;
}[] {
  const paths: { label: string; path: string }[] = [
    {
      label: 'Bundled Tectonic binary',
      path: path.join(context.extensionPath, 'bin')
    }
  ];
  // Tectonic's per-user cache (downloaded LaTeX packages, fonts, etc.).
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) paths.push({ label: 'Tectonic package cache', path: path.join(local, 'TectonicProject') });
  } else if (process.platform === 'darwin') {
    paths.push({ label: 'Tectonic package cache', path: path.join(os.homedir(), 'Library', 'Caches', 'Tectonic') });
  } else {
    paths.push({ label: 'Tectonic package cache', path: path.join(os.homedir(), '.cache', 'Tectonic') });
  }
  // VS Code-managed storage for this extension (settings flags, etc.).
  paths.push({ label: 'Extension global storage', path: context.globalStorageUri.fsPath });
  return paths;
}

/**
 * Returns true if a usable Tectonic engine is available right now.
 */
export function isEngineInstalled(context: vscode.ExtensionContext): boolean {
  const cfg = vscode.workspace.getConfiguration('latexStudio');
  const engine = cfg.get<string>('engine', 'tectonic');
  if (engine !== 'tectonic') return true; // user manages their own
  const configured = cfg.get<string>('tectonicPath', '').trim();
  if (configured && fs.existsSync(configured)) return true;
  const enginePath = resolveTectonicPath(context);
  return path.isAbsolute(enginePath) && fs.existsSync(enginePath);
}

/**
 * Ensure a usable engine binary is available before a build starts.
 *
 * If `latexStudio.tectonicPath` is set, trust the user — return early.
 * Otherwise, look for the bundled binary at `<extension>/bin/tectonic[.exe]`.
 * If missing, prompt the user once and (on confirmation) run the downloader
 * with a VS Code progress notification. Returns true if the build should
 * proceed.
 */
export async function ensureEngineAvailable(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<boolean> {
  if (isEngineInstalled(context)) return true;

  // Probe PATH as a last resort.
  const enginePath = resolveTectonicPath(context);
  if (!path.isAbsolute(enginePath) && (await isOnPath(enginePath))) return true;

  const choice = await vscode.window.showInformationMessage(
    'LaTeX Studio: Tectonic engine is not installed. Download it now? (~30 MB, one-time)',
    { modal: false },
    'Download',
    'Cancel'
  );
  if (choice !== 'Download') {
    output.appendLine(
      '✖ Build aborted — no engine available. Run "LaTeX: Download/Update Tectonic Engine" or set "latexStudio.tectonicPath".'
    );
    return false;
  }

  const ok = await downloadWithProgress(context, output);
  if (!ok) return false;

  // Re-check after download.
  if (isEngineInstalled(context)) return true;
  vscode.window.showErrorMessage(
    'LaTeX Studio: download finished but the engine binary was not found. See the LaTeX Studio output for details.'
  );
  return false;
}

async function isOnPath(exe: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(exe, ['--version'], { shell: false });
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    probe.on('error', () => finish(false));
    probe.on('close', (code) => finish(code === 0));
    setTimeout(() => { try { probe.kill(); } catch { /* ignore */ } finish(false); }, 3000);
  });
}

/**
 * Run the bundled `scripts/download-tectonic.js` with a progress notification.
 * Streams script output into the given OutputChannel.
 */
export async function downloadWithProgress(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<boolean> {
  const script = path.join(context.extensionPath, 'scripts', 'download-tectonic.js');
  if (!fs.existsSync(script)) {
    vscode.window.showErrorMessage(
      `LaTeX Studio: downloader script missing at ${script}. Reinstall the extension.`
    );
    return false;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'LaTeX Studio: downloading Tectonic engine…',
      cancellable: false
    },
    () =>
      new Promise<boolean>((resolve) => {
        output.show(true);
        output.appendLine(`▶ node ${script}`);
        const proc = spawn(process.execPath, [script], {
          cwd: context.extensionPath,
          shell: false
        });
        proc.stdout.on('data', (d: Buffer) => output.append(d.toString()));
        proc.stderr.on('data', (d: Buffer) => output.append(d.toString()));
        proc.on('close', (code) => {
          output.appendLine(`\n▶ downloader exited with code ${code ?? -1}`);
          resolve(code === 0);
        });
        proc.on('error', (err) => {
          output.appendLine(`\n✖ ${err.message}`);
          resolve(false);
        });
      })
  );
}

/**
 * Wipe every path this extension has installed or written to. Used by the
 * "Reset Everything" command, especially before uninstalling the extension.
 */
export async function resetAllData(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  const targets = getManagedPaths(context).filter((t) => fs.existsSync(t.path));
  if (targets.length === 0) {
    vscode.window.showInformationMessage('LaTeX Studio: nothing to clean.');
    return;
  }
  const msg =
    'LaTeX Studio will delete:\n\n' +
    targets.map((t) => `• ${t.label}\n   ${t.path}`).join('\n\n') +
    '\n\nProceed?';
  const choice = await vscode.window.showWarningMessage(msg, { modal: true }, 'Delete Everything');
  if (choice !== 'Delete Everything') return;

  output.show(true);
  for (const t of targets) {
    try {
      fs.rmSync(t.path, { recursive: true, force: true });
      output.appendLine(`✔ Removed ${t.label}: ${t.path}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      output.appendLine(`✖ Failed to remove ${t.path}: ${m}`);
    }
  }
  // Clear globalState flags (welcome shown, etc.).
  for (const key of context.globalState.keys()) {
    await context.globalState.update(key, undefined);
  }
  output.appendLine('✔ Cleared extension global state.');
  vscode.window.showInformationMessage(
    'LaTeX Studio: all extension data deleted. You can now safely uninstall the extension.'
  );
}

