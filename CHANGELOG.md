# Changelog

## [Unreleased]

###

- VS Code Language Model API integration with model selection

## [0.0.111]

### Added

- Configuration setting (`bc_al_upgradeassistant.languageModelBackend`) to select the language model backend: "Claude API" (external) or "VS Code Language Model API" (built-in `vscode.lm`).

### Changed

- Renamed command title from "Run Claude Prompt" to "Run Configured AI Prompt" to accurately reflect that it uses the configured language model backend (`bc_al_upgradeassistant.languageModelBackend`).

## [0.0.109]

- Enhanced symbol caching for faster performance: Includes improved detection of cache updates and a configurable processing delay (`alUpgradeAssistant.symbolCacheProcessingDelay`) for better responsiveness.

## [0.0.107]

### Added

- Integration Event Action Provider that generates event subscriber code for integration events

## [0.0.106]

- New Record Trigger Action Provider to generate AL event subscriber code

## [0.0.96]

- Fixed progress notification persistence issue

## [0.0.95]

- Added field name suggestion feature

## [0.0.85]

- Added source extraction for app files
- Enhance toggleDocumentationReferenceNotImplemented to prompt for user description

## [0.0.83]

- Added bulk operations for references in procedures, triggers, actions, and fields
- Added new grouping options in Documentation References view

## [0.0.75]

- Added grouping by task ID in Documentation References view if applicable
- Fixed Copy multiline comments, keep intendation

## [0.0.69]

- Added new command "Split C/AL Objects (Select File)" to extract objects from a file without opening it
- Enhanced object extraction with better progress feedback
