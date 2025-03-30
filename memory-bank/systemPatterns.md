# System Patterns

_This file documents the system architecture, key technical decisions, design patterns in use, component relationships, and critical implementation paths._

## Architecture Overview

## Key Technical Decisions

## Design Patterns

- **Submodule for Specialized Logic:** External or distinct functionalities (like AL/C/AL parsing) are encapsulated within Git submodules (e.g., `al-parser-lib`) to promote modularity and potential reuse.
- **Dependency Injection (Function Passing):** Dependencies between modules are managed by passing required functions as parameters (e.g., passing `isIdInRanges` to the AL parser functions).

## Component Relationships

- `src/utils/alCodeFilter.js`: Acts as the main entry point for code filtering. It handles detecting code type (AL vs C/AL) and orchestrates the filtering process. It retains logic dependent on other parts of the main project (like `calParser` for C/AL and ID range extraction).
- `al-parser-lib/calParser.js`: (Submodule) Handles parsing and filtering of legacy C/AL code.
- `al-parser-lib/alparser.js`: (Submodule) Handles parsing and filtering of modern AL code (table fields, page controls). It receives necessary helper functions (like `isIdInRanges`) via parameters.

## Critical Implementation Paths

- **Code Filtering (`filterToIdRanges`):**
  1. Get ID ranges (`getIdRangesFromAppJson` via `calParser`).
  2. Check if code is C/AL or AL.
  3. If C/AL, delegate to `calParser.filterCALToIdRanges`.
  4. If AL, delegate to `alParser.filterTableFields` and `alParser.filterPageControls`, passing `isIdInRanges` function as a dependency.
