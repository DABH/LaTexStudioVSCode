/* eslint-disable no-console */
/**
 * Post-install script: download the Tectonic LaTeX engine binary for the
 * current platform/arch into ./bin/. Skipped silently if the binary already
 * exists or if running in CI where the file is provided externally.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream');
const { promisify } = require('util');
const zlib = require('zlib');
const { execSync } = require('child_process');

const streamPipeline = promisify(pipeline);

const TECTONIC_VERSION = '0.17.0';

/** GitHub release asset name for each platform. */
function assetForPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32' && arch === 'x64') {
    return {
      name: `tectonic-${TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip`,
      exe: 'tectonic.exe',
      archive: 'zip'
    };
  }
  if (platform === 'darwin') {
    const tag = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    return {
      name: `tectonic-${TECTONIC_VERSION}-${tag}.tar.gz`,
      exe: 'tectonic',
      archive: 'tar.gz'
    };
  }
  if (platform === 'linux' && arch === 'x64') {
    return {
      name: `tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
      exe: 'tectonic',
      archive: 'tar.gz'
    };
  }
  if (platform === 'linux' && arch === 'arm64') {
    return {
      name: `tectonic-${TECTONIC_VERSION}-aarch64-unknown-linux-musl.tar.gz`,
      exe: 'tectonic',
      archive: 'tar.gz'
    };
  }
  return null;
}

function downloadFollowingRedirects(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return resolve(downloadFollowingRedirects(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      streamPipeline(res, file).then(resolve).catch(reject);
    });
    req.on('error', reject);
  });
}

async function extract(archivePath, targetDir, kind) {
  if (kind === 'zip') {
    // Use built-in PowerShell on Windows.
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${archivePath}' -DestinationPath '${targetDir}'"`, { stdio: 'inherit' });
    } else {
      execSync(`unzip -o "${archivePath}" -d "${targetDir}"`, { stdio: 'inherit' });
    }
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { stdio: 'inherit' });
  }
}

async function main() {
  if (process.env.LATEXSTUDIO_SKIP_DOWNLOAD === '1') {
    console.log('[tectonic] LATEXSTUDIO_SKIP_DOWNLOAD=1 — skipping engine download.');
    return;
  }

  const asset = assetForPlatform();
  if (!asset) {
    console.warn(`[tectonic] Unsupported platform ${process.platform}/${process.arch} — engine not downloaded. Set 'latexStudio.tectonicPath' or install a TeX distribution.`);
    return;
  }

  const binDir = path.join(__dirname, '..', 'bin');
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const exePath = path.join(binDir, asset.exe);
  if (fs.existsSync(exePath)) {
    console.log(`[tectonic] Engine already present at ${exePath} — skipping.`);
    return;
  }

  const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/${asset.name}`;
  const archivePath = path.join(binDir, asset.name);
  console.log(`[tectonic] Downloading ${url}`);
  try {
    await downloadFollowingRedirects(url, archivePath);
    console.log('[tectonic] Extracting...');
    await extract(archivePath, binDir, asset.archive);
    try { fs.unlinkSync(archivePath); } catch { /* ignore */ }
    if (process.platform !== 'win32') {
      try { fs.chmodSync(exePath, 0o755); } catch { /* ignore */ }
    }
    if (!fs.existsSync(exePath)) {
      console.warn(`[tectonic] Archive extracted but ${asset.exe} not found in ${binDir}. The extension will fall back to system tectonic if available.`);
      return;
    }
    console.log(`[tectonic] Installed at ${exePath}`);
  } catch (err) {
    console.warn(`[tectonic] Download failed: ${err && err.message}. The extension will fall back to system tectonic if available.`);
  }
}

main().catch((err) => {
  console.warn(`[tectonic] Unexpected error: ${err && err.stack || err}`);
});
