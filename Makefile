# Cairn — task runner
#
# Thin wrapper over the package-manager scripts so there's a single
# entry point regardless of which package manager is in use. Override
# the package manager per-invocation:
#
#     make dev PKG=pnpm
#
# Until build step 1 lands, the underlying npm scripts don't exist yet
# — these targets are the contract, not the implementation.

PKG ?= npm

.DEFAULT_GOAL := help

.PHONY: help install dev build typecheck lint test package clean distclean

help:  ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { \
		printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 \
	}' $(MAKEFILE_LIST)

install:  ## Install dependencies
	$(PKG) install

dev:  ## Run the app in dev mode (electron-vite)
	$(PKG) run dev

build:  ## Build production bundles (main, preload, renderer)
	$(PKG) run build

typecheck:  ## Type-check without emitting
	$(PKG) run typecheck

lint:  ## Lint sources
	$(PKG) run lint

test:  ## Run tests
	$(PKG) run test

package:  ## Build distributable installers (electron-builder)
	$(PKG) run package

clean:  ## Remove build output
	rm -rf dist out build *.tsbuildinfo

distclean: clean  ## Remove build output and node_modules
	rm -rf node_modules
