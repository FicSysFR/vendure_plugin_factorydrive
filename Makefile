#!make

RELEASE_BRANCH ?= main

VERSION ?=
PRERELEASE ?=

INCREMENT ?= patch
NPM_PUBLISH ?= true
WATCH ?=
YES ?=

.PHONY: help install build lint lint-fix typecheck test test-watch test-coverage test-e2e test-e2e-s3 test-e2e-clean smoke pack-check check release release-ci
.DEFAULT_GOAL := help

help: ## Show this help
	@printf "\033[33mUsage:\033[0m\n  make [target] [arg=\"val\"...]\n\n\033[33mTargets:\033[0m\n"
	@awk 'BEGIN { FS = ":.*##"; } /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install dependencies (yarn)
	@yarn install

build: ## Build the package (tsc -> dist/)
	@yarn build

lint: ## Lint the codebase (Biome)
	@yarn lint

lint-fix: ## Lint and auto-fix (Biome --write)
	@yarn lint:fix

typecheck: ## Type-check src and tests
	@yarn typecheck

test: ## Run unit tests (Vitest)
	@yarn test

test-watch: ## Run unit tests in watch mode
	@yarn test:watch

test-coverage: ## Run unit tests with coverage
	@yarn test:coverage

test-e2e: ## Run end-to-end tests against a real Vendure server
	@yarn test:e2e

test-e2e-s3: ## Run end-to-end tests against S3-compatible storage (RustFS)
	@yarn test:e2e:s3

test-e2e-clean: ## Remove e2e test data (e2e/__data__)
	@yarn test:e2e:clean

smoke: ## Smoke-test the built dist/ output
	@yarn smoke

pack-check: ## Verify the npm tarball contents (npm pack --dry-run)
	@yarn pack:check

check: lint typecheck test-coverage build smoke pack-check ## Full local verify (mirrors the CI "verify" job)

release: ## Publish a release: bump version + CHANGELOG, commit, tag, push, create GitHub Release (VERSION=X.Y.Z [PRERELEASE=1])
	@node scripts/release.cjs --version "$(VERSION)" --branch "$(RELEASE_BRANCH)" $(if $(strip $(PRERELEASE)),--prerelease,)

release-ci: ## Run the GitHub Release workflow: CI + version bump + GitHub Release + npm publish (INCREMENT=patch|minor|major [NPM_PUBLISH=true|false] [WATCH=1] [YES=1])
	@node scripts/release-workflow.cjs --increment "$(INCREMENT)" --npm-publish "$(NPM_PUBLISH)" --branch "$(RELEASE_BRANCH)" $(if $(strip $(WATCH)),--watch,) $(if $(strip $(YES)),--yes,)
