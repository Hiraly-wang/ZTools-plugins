const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const INSTALL_TIMEOUT_MS = 120000
const RELEASE_BASE = 'https://github.com/pranshuparmar/witr/releases/latest/download/'

let _installPromise = null
let _debugLog = []

function debugPush(msg) {
  _debugLog.push(msg)
}

function getDebugLog() {
  const logs = _debugLog
  _debugLog = []
  return logs
}

/** Paths inside .asar cannot be spawn()'d — Electron can read them, not exec them. */
function isAsarPath(p) {
  return /(^|[\\/])[^\s\\/]+\.asar([\\/]|$)/i.test(String(p || ''))
}

/**
 * Writable real-FS directory for the extracted/downloaded witr.exe.
 * NEVER inside a .asar (spawn would ENOENT).
 */
function runtimeToolsDir() {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    process.env.TEMP ||
    os.tmpdir()
  return path.join(base, 'unlock-file', 'tools')
}

function runtimeWitrPath() {
  return path.join(runtimeToolsDir(), 'witr.exe')
}

/** Bundled source inside the plugin package (may live in asar — copy, don't spawn). */
function bundledWitrPaths() {
  return [
    path.join(__dirname, 'tools', 'witr.exe'),
    path.join(__dirname, 'witr.exe'),
    path.join(__dirname, '..', '..', 'tools', 'witr.exe')
  ]
}

function toolsDir() {
  return runtimeToolsDir()
}

function toolsWitrPath() {
  return runtimeWitrPath()
}

function releaseZipName() {
  const arch = String(process.env.PROCESSOR_ARCHITECTURE || process.arch || '')
  return /arm/i.test(arch) ? 'witr-windows-arm64.zip' : 'witr-windows-amd64.zip'
}

function isSpawnableExe(p) {
  if (!p || isAsarPath(p)) return false
  try {
    if (!fs.existsSync(p)) return false
    const st = fs.statSync(p)
    return st.isFile() && st.size > 0
  } catch (e) {
    return false
  }
}

function findOnPath() {
  try {
    const whereOut = execFileSync('where.exe', ['witr'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const lines = whereOut.split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      if (isSpawnableExe(lines[i])) return lines[i]
    }
  } catch (e) {}
  // winget default location
  const winget = path.join(process.env.LOCALAPPDATA || '', 'witr', 'bin', 'witr.exe')
  if (isSpawnableExe(winget)) return winget
  return null
}

/**
 * Sync lookup of a *spawnable* witr.exe (real filesystem, not inside asar).
 */
function findWitrBinSync() {
  const runtime = runtimeWitrPath()
  if (isSpawnableExe(runtime)) return runtime

  // Dev / unpacked plugin: tools next to this file may already be on real disk
  const bundled = bundledWitrPaths()
  for (let i = 0; i < bundled.length; i++) {
    if (isSpawnableExe(bundled[i])) return bundled[i]
  }

  return findOnPath()
}

/** Source bytes we can copy out of asar (or real bundled file). */
function findBundledSource() {
  const bundled = bundledWitrPaths()
  for (let i = 0; i < bundled.length; i++) {
    try {
      if (fs.existsSync(bundled[i])) {
        const st = fs.statSync(bundled[i])
        if (st.isFile() && st.size > 0) return bundled[i]
      }
    } catch (e) {}
  }
  return null
}

/**
 * Copy witr.exe out of asar (or plugin dir) to a real spawnable path.
 * @returns {string|null}
 */
function extractBundledWitr() {
  const src = findBundledSource()
  if (!src) {
    debugPush('[witr-install] no bundled witr source found')
    return null
  }
  const dest = runtimeWitrPath()
  if (isSpawnableExe(dest)) return dest

  try {
    fs.mkdirSync(runtimeToolsDir(), { recursive: true })
  } catch (e) {
    debugPush('[witr-install] mkdir failed: ' + e.message)
    return null
  }

  try {
    // read/write works with asar virtual FS; spawn does not
    const buf = fs.readFileSync(src)
    fs.writeFileSync(dest, buf)
    debugPush('[witr-install] extracted ' + src + ' → ' + dest + ' (' + buf.length + ' bytes)')
  } catch (e) {
    debugPush('[witr-install] extract failed: ' + e.message)
    try {
      fs.copyFileSync(src, dest)
      debugPush('[witr-install] copied ' + src + ' → ' + dest)
    } catch (e2) {
      debugPush('[witr-install] copy failed: ' + e2.message)
      return null
    }
  }

  return isSpawnableExe(dest) ? dest : null
}

function runPowerShellDownload(url, dest) {
  const destPs = String(dest).replace(/'/g, "''")
  const urlPs = String(url).replace(/'/g, "''")
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$ProgressPreference = "SilentlyContinue"',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    '$zip = Join-Path $env:TEMP ("witr-install-" + [guid]::NewGuid().ToString() + ".zip")',
    '$extract = Join-Path $env:TEMP ("witr-extract-" + [guid]::NewGuid().ToString())',
    'try {',
    '  Invoke-WebRequest -Uri \'' + urlPs + '\' -OutFile $zip -UseBasicParsing',
    '  Expand-Archive -Path $zip -DestinationPath $extract -Force',
    '  $exe = Get-ChildItem -Path $extract -Filter "witr.exe" -Recurse | Select-Object -First 1',
    '  if (-not $exe) { throw "witr.exe not found in archive" }',
    '  $dir = Split-Path -Parent \'' + destPs + '\'',
    '  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '  Copy-Item $exe.FullName \'' + destPs + '\' -Force',
    '  Write-Output ("installed " + \'' + destPs + '\')',
    '} finally {',
    '  Remove-Item $zip -Force -ErrorAction SilentlyContinue',
    '  Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue',
    '}'
  ].join('\n')

  return new Promise(function (resolve) {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], { windowsHide: true, timeout: INSTALL_TIMEOUT_MS })

    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', function (d) { stdout += d })
    proc.stderr.on('data', function (d) { stderr += d })
    proc.on('error', function (err) {
      resolve({ ok: false, stdout: '', stderr: err.message })
    })
    proc.on('close', function (code) {
      resolve({ ok: code === 0, stdout: stdout, stderr: stderr })
    })
  })
}

/**
 * Download witr.exe into the real runtime tools dir (never asar).
 */
function downloadWitr() {
  const dest = runtimeWitrPath()
  const zipName = releaseZipName()
  const url = RELEASE_BASE + zipName
  debugPush('[witr-install] downloading ' + url)

  try {
    fs.mkdirSync(runtimeToolsDir(), { recursive: true })
  } catch (e) {
    return Promise.reject(new Error('无法创建 tools 目录: ' + e.message))
  }

  return runPowerShellDownload(url, dest).then(function (res) {
    if (!res.ok || !isSpawnableExe(dest)) {
      const why = (res.stderr || res.stdout || ('exit failed')).trim().slice(0, 200)
      throw new Error('下载 witr 失败: ' + why)
    }
    const size = fs.statSync(dest).size
    debugPush('[witr-install] ok ' + dest + ' (' + size + ' bytes)')
    return dest
  })
}

/**
 * Find a spawnable witr, extracting from the plugin package if needed,
 * then downloading / winget as fallback. Concurrent callers share one install.
 * @returns {Promise<string|null>}
 */
function ensureWitr() {
  const existing = findWitrBinSync()
  if (existing) return Promise.resolve(existing)

  if (_installPromise) return _installPromise

  _installPromise = Promise.resolve().then(function () {
    // 1) extract from asar / plugin bundle → real path
    const extracted = extractBundledWitr()
    if (extracted) return extracted

    // 2) download from GitHub releases
    return downloadWitr().catch(function (err) {
      debugPush('[witr-install] zip download failed: ' + err.message + ' — trying winget')
      return tryWingetInstall().then(function (viaWinget) {
        if (viaWinget) return viaWinget
        throw err
      })
    })
  }).then(function (bin) {
    return bin
  }).catch(function (err) {
    debugPush('[witr-install] auto-install failed: ' + err.message)
    return null
  }).finally(function () {
    _installPromise = null
  })

  return _installPromise
}

function tryWingetInstall() {
  return new Promise(function (resolve) {
    const proc = spawn('winget', [
      'install', '-e', '--id', 'PranshuParmar.witr',
      '--accept-package-agreements', '--accept-source-agreements', '--silent'
    ], { windowsHide: true, timeout: INSTALL_TIMEOUT_MS })

    let stderr = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', function (d) { stderr += d })
    proc.on('error', function () { resolve(null) })
    proc.on('close', function () {
      const found = findOnPath()
      if (found) {
        debugPush('[witr-install] winget installed: ' + found)
        resolve(found)
      } else {
        resolve(null)
      }
    })
  })
}

module.exports = {
  isAsarPath,
  isSpawnableExe,
  findWitrBinSync,
  findBundledSource,
  extractBundledWitr,
  downloadWitr,
  ensureWitr,
  runtimeToolsDir,
  runtimeWitrPath,
  toolsDir,
  toolsWitrPath,
  releaseZipName,
  getDebugLog
}
