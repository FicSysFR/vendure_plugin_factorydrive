#!/usr/bin/env node
// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

/**
 * Local release: bumps the version, updates CHANGELOG.md, commits, tags, pushes and creates
 * a GitHub Release. Does not build or publish to npm — that only happens through the
 * release.yml workflow (`make release-ci`), which also runs the full CI suite first.
 *
 *   node scripts/release.cjs --version 0.1.0 [--prerelease] [--branch main]
 */
const { execFileSync, execSync } = require('node:child_process')
const { existsSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

/** gh may be missing from PATH if the terminal was opened before GitHub CLI was installed. */
function resolveGh() {
  const fromEnv = process.env.GH?.trim()
  if (fromEnv) return fromEnv

  const candidates = []
  if (process.platform === 'win32') {
    candidates.push('C:/Program Files/GitHub CLI/gh.exe', 'C:/Program Files (x86)/GitHub CLI/gh.exe')
    if (process.env.LOCALAPPDATA) candidates.push(`${process.env.LOCALAPPDATA}/Programs/GitHub CLI/gh.exe`)
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  try {
    execSync('gh --version', { stdio: 'ignore', shell: true })
    return 'gh'
  } catch {
    console.error('ERROR: "gh" (GitHub CLI) not found on PATH.\n→ Or force the binary: GH="C:/Program Files/GitHub CLI/gh.exe" make release VERSION=X.Y.Z')
    process.exit(1)
  }
}

function parseArgs(argv) {
  let version = ''
  let branch = 'main'
  let prerelease = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--version' || arg === '-v') version = argv[++i] ?? ''
    else if (arg === '--branch' || arg === '-b') branch = argv[++i] ?? 'main'
    else if (arg === '--prerelease' || arg === '-p') prerelease = true
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/release.cjs --version X.Y.Z [--prerelease] [--branch main]')
      process.exit(0)
    }
  }
  return { version: version.trim(), branch: branch.trim() || 'main', prerelease }
}

function run(cmd, args, { useShell = false } = {}) {
  try {
    execFileSync(cmd, args, { stdio: 'inherit', shell: useShell })
  } catch (error) {
    console.error(`\nERROR: command failed: ${[cmd, ...args].join(' ')}`)
    process.exit(error.status ?? 1)
  }
}

function main() {
  const { version, branch, prerelease } = parseArgs(process.argv.slice(2))

  if (!version) {
    console.error('ERROR: VERSION is required, e.g. make release VERSION=0.1.0 [PRERELEASE=1]')
    process.exit(1)
  }

  const notesPath = join(mkdtempSync(join(tmpdir(), 'factorydrive-release-')), 'notes.md')

  run(process.execPath, ['scripts/prepare-release.cjs', '--version', version, '--notes-out', notesPath])

  const tag = `v${version}`
  console.log(`\nPushing ${tag} to ${branch}...`)
  run('git', ['push', 'origin', branch])
  run('git', ['push', 'origin', tag])

  const gh = resolveGh()
  const ghArgs = ['release', 'create', tag, '--target', branch, '--title', tag, '--notes-file', notesPath]
  ghArgs.push(prerelease ? '--prerelease' : '--latest')
  run(gh, ghArgs, { useShell: gh === 'gh' })

  console.log(`\nRelease ${tag} published on GitHub.`)
  console.log('This did not publish to npm — run `make release-ci` for the full pipeline (CI, build, tests, npm publish).')
}

main()
