import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { resolveTectonicPath, buildTectonicArgs } from '../engine/tectonic';
import { ensureEngineAvailable } from '../engine/engineSetup';
import { resolveRootTex, resolveOutputDir, expectedPdfPath, finalPdfPath } from './rootResolver';
import { parseLatexLog, publishDiagnostics } from './logParser';

export interface BuildResult {
  ok: boolean;
  rootTex: string;
  pdfPath: string;
  durationMs: number;
  exitCode: number;
}

export type BuildListener = (result: BuildResult) => void;

/**
 * Serializes builds: at most one in flight; a queued request supersedes any
 * earlier pending request. Cancels the running engine if a newer build comes
 * in for the same root.
 */
export class Builder {
  private running: { proc: ReturnType<typeof spawn>; rootTex: string } | null = null;
  private pending: vscode.TextDocument | null = null;
  private listeners: BuildListener[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly diagnostics: vscode.DiagnosticCollection,
    private readonly status: vscode.StatusBarItem
  ) {}

  onBuildComplete(listener: BuildListener): vscode.Disposable {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      }
    };
  }

  /** Queue a build for the given document (or active editor's document). */
  async requestBuild(doc?: vscode.TextDocument): Promise<void> {
    const target = doc ?? vscode.window.activeTextEditor?.document;
    if (!target || target.languageId !== 'latex') {
      vscode.window.showWarningMessage('LaTeX Studio: open a .tex file to build.');
      return;
    }
    if (this.running) {
      this.pending = target;
      this.running.proc.kill();
      return;
    }
    await this.runBuild(target);
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      await this.runBuild(next);
    }
  }

  private async runBuild(doc: vscode.TextDocument): Promise<void> {
    // Self-heal: prompt + download Tectonic if it's missing.
    const engineOk = await ensureEngineAvailable(this.context, this.output);
    if (!engineOk) {
      this.status.text = '$(error) LaTeX: no engine';
      return;
    }
    // Ensure the file is saved so the engine sees latest content.
    if (doc.isDirty) {
      await doc.save();
    }
    const rootTex = resolveRootTex(doc);
    const outDir = resolveOutputDir(rootTex);
    const buildPdf = expectedPdfPath(rootTex, outDir);
    const finalPdf = finalPdfPath(rootTex);
    const enginePath = resolveTectonicPath(this.context);
    const args = buildTectonicArgs(rootTex, outDir);

    this.output.clear();
    this.output.appendLine(`▶ ${enginePath} ${args.join(' ')}`);
    this.output.appendLine(`  cwd: ${path.dirname(rootTex)}`);
    this.status.text = '$(sync~spin) LaTeX: building…';
    this.status.show();

    const started = Date.now();
    let logBuf = '';

    const proc = spawn(enginePath, args, {
      cwd: path.dirname(rootTex),
      shell: false
    });
    this.running = { proc, rootTex };

    proc.stdout.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      logBuf += s;
      this.output.append(s);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      logBuf += s;
      this.output.append(s);
    });

    const exitCode: number = await new Promise((resolve) => {
      proc.on('error', (err) => {
        this.output.appendLine(`\n✖ Failed to launch engine: ${err.message}`);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.output.appendLine(
            '  Tectonic executable not found. Run command "LaTeX: Download/Update Tectonic Engine" or set "latexStudio.tectonicPath".'
          );
        }
        resolve(-1);
      });
      proc.on('close', (code) => resolve(code ?? -1));
    });

    this.running = null;
    const durationMs = Date.now() - started;

    // Also try reading the .log file Tectonic writes — it's richer than stdout.
    const logFile = path.join(outDir, path.basename(rootTex, path.extname(rootTex)) + '.log');
    if (fs.existsSync(logFile)) {
      try {
        logBuf += '\n' + fs.readFileSync(logFile, 'utf8');
      } catch { /* ignore */ }
    }
    const parsed = parseLatexLog(logBuf, path.dirname(rootTex));
    publishDiagnostics(this.diagnostics, parsed);

    const ok = exitCode === 0 && fs.existsSync(buildPdf);
    const errors = parsed.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warns = parsed.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;

    let pdfPath = buildPdf;
    if (ok) {
      try {
        // Move (not copy): we only want one PDF, alongside the source.
        fs.copyFileSync(buildPdf, finalPdf);
        try { fs.unlinkSync(buildPdf); } catch { /* ignore */ }
        pdfPath = finalPdf;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.output.appendLine(`! Could not move PDF next to source (${msg}); using ${buildPdf}.`);
      }
    }

    if (ok) {
      this.status.text = `$(check) LaTeX: built in ${(durationMs / 1000).toFixed(1)}s${warns ? ` · ${warns} warn` : ''}`;
      this.output.appendLine(`\n✔ Build succeeded in ${durationMs} ms → ${pdfPath}`);
    } else {
      this.status.text = `$(error) LaTeX: failed${errors ? ` · ${errors} err` : ''}`;
      this.output.appendLine(`\n✖ Build failed (exit ${exitCode}).`);
      this.output.show(true);
    }

    const result: BuildResult = { ok, rootTex, pdfPath, durationMs, exitCode };
    for (const listener of this.listeners) {
      try { listener(result); } catch (e) { console.error(e); }
    }
  }

  dispose(): void {
    if (this.running) {
      try { this.running.proc.kill(); } catch { /* ignore */ }
    }
  }
}
