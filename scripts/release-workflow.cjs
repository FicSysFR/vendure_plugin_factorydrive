#!/usr/bin/env node
// Copyright 2026 FicSys
// SPDX-License-Identifier: Apache-2.0

/**
 * Triggers the GitHub Release workflow (.github/workflows/release.yml), which runs the full
 * CI suite, bumps the version, updates CHANGELOG.md, creates the GitHub Release and publishes
 * to npm.
 *
 *   node scripts/release-workflow.cjs --increment patch [--npm-publish true] [--branch main] [--watch] [--yes]
 */
const { execFileSync, execSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { createInterface } = require('node:readline/promises')

const WORKFLOW = 'release.yml'
const INCREMENTS = new Set(['major', 'minor', 'patch'])

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
    console.error('ERROR: "gh" (GitHub CLI) not found on PATH.\n→ Or force the binary: GH="C:/Program Files/GitHub CLI/gh.exe" make release-ci')
    process.exit(1)
  }
}

function parseBoolean(value, label) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false
  console.error(`ERROR: ${label} must be true or false (got "${value}")`)
  process.exit(1)
}

function parseArgs(argv) {
  let increment = 'patch'
  let npmPublish = 'true'
  let branch = 'main'
  let watch = false
  let yes = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--increment' || arg === '-i') increment = argv[++i] ?? ''
    else if (arg === '--npm-publish') npmPublish = argv[++i] ?? ''
    else if (arg === '--branch' || arg === '-b') branch = argv[++i] ?? 'main'
    else if (arg === '--watch' || arg === '-w') watch = true
    else if (arg === '--yes' || arg === '-y') yes = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/release-workflow.cjs [--increment patch|minor|major] [--npm-publish true|false]\n' +
          '                                        [--branch main] [--watch] [--yes]',
      )
      process.exit(0)
    }
  }

  increment = increment.trim().toLowerCase()
  if (!INCREMENTS.has(increment)) {
    console.error(`ERROR: INCREMENT must be one of major, minor, patch (got "${increment}")`)
    process.exit(1)
  }

  return { increment, npmPublish: parseBoolean(npmPublish, 'NPM_PUBLISH'), branch: branch.trim() || 'main', watch, yes }
}

function ghOutput(gh, args) {
  return execFileSync(gh, args, { encoding: 'utf8', shell: gh === 'gh' }).trim()
}

function run(gh, args) {
  try {
    execFileSync(gh, args, { stdio: 'inherit', shell: gh === 'gh' })
  } catch (error) {
    console.error(`\nERROR: command failed: ${[gh, ...args].join(' ')}`)
    process.exit(error.status ?? 1)
  }
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
  rl.close()
  return answer === 'y' || answer === 'yes'
}

/** The dispatch API returns no run id — poll the workflow's recent runs instead. */
async function findRun(gh, branch, since) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const raw = ghOutput(gh, ['run', 'list', '--workflow', WORKFLOW, '--branch', branch, '--event', 'workflow_dispatch', '--limit', '5', '--json', 'databaseId,createdAt,url'])
    const runs = JSON.parse(raw).filter((entry) => new Date(entry.createdAt).getTime() >= since)
    if (runs.length > 0) return runs[0]
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return null
}

async function main() {
  const { increment, npmPublish, branch, watch, yes } = parseArgs(process.argv.slice(2))
  const gh = resolveGh()

  console.log(`Workflow   : ${WORKFLOW}`)
  console.log(`Branch     : ${branch}`)
  console.log(`Increment  : ${increment}`)
  console.log(`npm publish: ${npmPublish ? 'yes' : 'no'}`)

  if (!yes && !(await confirm('\nTrigger this release on GitHub?'))) {
    console.log('Cancelled.')
    process.exit(0)
  }

  const since = Date.now() - 5000
  run(gh, ['workflow', 'run', WORKFLOW, '--ref', branch, '-f', `version_increment=${increment}`, '-f', `npm_publish=${npmPublish}`])

  const workflowRun = await findRun(gh, branch, since)
  if (!workflowRun) {
    console.log(`Release triggered. Track it with: gh run list --workflow ${WORKFLOW}`)
    return
  }

  console.log(`\nRun: ${workflowRun.url}`)
  if (watch) {
    run(gh, ['run', 'watch', String(workflowRun.databaseId), '--exit-status'])
  }
}

main()
