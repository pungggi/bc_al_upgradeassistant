# Technical Context

_This file details the technologies used, development setup, technical constraints, dependencies, and tool usage patterns._

## Technologies Used

## Development Setup

## Technical Constraints

- **Submodule Management:** Requires proper Git commands (`git submodule update --init --recursive`) to ensure the `al-parser-lib` submodule code is present locally. Changes within the submodule need to be committed and pushed separately within the submodule's repository, and then the main project needs to commit the updated submodule reference.

## Dependencies

- **Internal:**
  - `src/utils/calParser.js`: Used by `alCodeFilter.js` for C/AL parsing and ID range extraction.
- **Submodules:**
  - `al-parser-lib`: Contains parsers for C/AL (`calParser.js`) and modern AL (`alparser.js`). The main project (`src/utils/alCodeFilter.js`) now depends on `al-parser-lib/alparser.js`.
- **External (npm):** (Refer to `package.json` for a full list)
  - `axios`: For API calls (likely Claude).
  - `glob`: File matching.
  - `jszip`: Handling zip files (likely for `.app` file extraction).
  - `fastest-levenshtein`: String similarity calculations (likely for field suggestions).

## Tool Usage Patterns

- **Git Submodules:** Used to incorporate the `al-parser-lib` repository.
