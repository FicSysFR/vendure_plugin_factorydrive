#!/usr/bin/env node
// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

/**
 * Bumps package.json's version and moves CHANGELOG.md's "## [Unreleased]" section into a
 * dated "## [X.Y.Z]" one, then commits and tags the result. Shared by `make release`
 * (--version) and the release.yml workflow (--increment). Does not push or publish anything.
 *
 *   node scripts/prepare-release.cjs --version 0.1.0 [--notes-out file] [--github-env]
 *   node scripts/prepare-release.cjs --increment patch [--notes-out file] [--github-env]
 */
const { execFileSync } = require('node:child_process')
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname } = require('node:path')

const SEMVER_RE = /^\d+\.\d+\.\d+$/
const INCREMENTS = new Set(['major', 'minor', 'patch'])
const PACKAGE_JSON = 'package.json'
const CHANGELOG = 'CHANGELOG.md'

function parseArgs(argv) {
  const args = { version: '', increment: '', notesOut: '', githubEnv: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--version') args.version = argv[++i] ?? ''
    else if (arg === '--increment') args.increment = argv[++i] ?? ''
    else if (arg === '--notes-out') args.notesOut = argv[++i] ?? ''
    else if (arg === '--github-env') args.githubEnv = true
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/prepare-release.cjs (--version X.Y.Z | --increment major|minor|patch) [--notes-out file] [--github-env]')
      process.exit(0)
    }
  }
  return args
}

function bump(current, increment) {
  const [major, minor, patch] = current.split('.').map(Number)
  if (increment === 'major') return `${major + 1}.0.0`
  if (increment === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function tagExists(tag) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Splits CHANGELOG.md around the `## [Unreleased]` heading into { before, body, after } line arrays. */
function splitUnreleased(changelog) {
  const lines = changelog.split('\n')
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === '## [unreleased]')
  if (startIndex === -1) {
    console.error(`ERROR: ${CHANGELOG} has no "## [Unreleased]" section.`)
    process.exit(1)
  }
  let endIndex = lines.length
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      endIndex = i
      break
    }
  }
  return { before: lines.slice(0, startIndex), body: lines.slice(startIndex + 1, endIndex), after: lines.slice(endIndex) }
}

function trimBlock(lines) {
  const start = lines.findIndex((line) => line.trim() !== '')
  if (start === -1) return []
  let end = lines.length - 1
  while (end >= 0 && lines[end].trim() === '') end--
  return lines.slice(start, end + 1)
}

function main() {
  const { version: versionArg, increment, notesOut, githubEnv } = parseArgs(process.argv.slice(2))

  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
  const currentVersion = pkg.version

  let version = versionArg.trim()
  if (!version) {
    if (!INCREMENTS.has(increment)) {
      console.error('ERROR: pass --version X.Y.Z or --increment major|minor|patch')
      process.exit(1)
    }
    version = bump(currentVersion, increment)
  }

  if (!SEMVER_RE.test(version)) {
    console.error(`ERROR: version "${version}" must look like X.Y.Z`)
    process.exit(1)
  }

  const tag = `v${version}`
  if (tagExists(tag)) {
    console.error(`ERROR: tag ${tag} already exists locally.`)
    process.exit(1)
  }

  if (!existsSync(CHANGELOG)) {
    console.error(`ERROR: ${CHANGELOG} not found.`)
    process.exit(1)
  }

  const { before, body, after } = splitUnreleased(readFileSync(CHANGELOG, 'utf8'))
  const releaseNotes = trimBlock(body)

  if (releaseNotes.length === 0) {
    console.error(`ERROR: ${CHANGELOG} "## [Unreleased]" section is empty — nothing to release.`)
    process.exit(1)
  }

  const releaseDate = new Date().toISOString().slice(0, 10)
  const rebuilt = `${[...before, '## [Unreleased]', '', `## [${version}] - ${releaseDate}`, '', ...releaseNotes, '', ...after]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n*$/, '')}\n`

  writeFileSync(CHANGELOG, rebuilt)

  pkg.version = version
  writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`)

  if (notesOut) {
    mkdirSync(dirname(notesOut), { recursive: true })
    writeFileSync(notesOut, `${releaseNotes.join('\n')}\n`)
  }

  if (githubEnv && process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `NEW_VERSION=${version}\nRELEASE_TAG=${tag}\n`)
  }

  execFileSync('git', ['add', PACKAGE_JSON, CHANGELOG], { stdio: 'inherit' })

  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim()
  if (staged) {
    execFileSync('git', ['commit', '-m', `chore(release): ${tag}`], { stdio: 'inherit' })
  } else {
    console.log('No changes to commit (package.json and CHANGELOG.md already up to date).')
  }

  execFileSync('git', ['tag', '-a', tag, '-m', `Release ${tag}`], { stdio: 'inherit' })

  console.log(`Prepared ${tag} (from ${currentVersion}).`)
}

main()
