import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Locate the Tectonic executable, in this order:
 *  1. `latexStudio.tectonicPath` setting (if non-empty)
 *  2. Bundled binary under <extension>/bin/
 *  3. System `tectonic` on PATH (resolved by spawning)
 */
export function resolveTectonicPath(context: vscode.ExtensionContext): string {
  const configured = vscode.workspace
    .getConfiguration('latexStudio')
    .get<string>('tectonicPath', '')
    .trim();
  if (configured) {
    return configured;
  }
  const exe = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic';
  const bundled = path.join(context.extensionPath, 'bin', exe);
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  // Fall back to PATH lookup; child_process will resolve.
  return 'tectonic';
}

/**
 * Build the argument vector for a Tectonic compilation.
 * We always enable SyncTeX and keep intermediates so subsequent rebuilds
 * are fast and inverse search works.
 */
export function buildTectonicArgs(rootTex: string, outDir: string): string[] {
  return [
    '-X',
    'compile',
    '--synctex',
    '--keep-logs',
    '--keep-intermediates',
    '--outdir',
    outDir,
    rootTex
  ];
}
