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

## Symbol Cache Mechanism

This section details the implementation and functionality of the symbol cache (`src/symbolCache.js`), which is crucial for providing context-aware features like object suggestions and procedure lookups.

### Implementation Overview

The `SymbolCache` class manages the caching of AL object symbols (like tables, pages, codeunits) and their procedures.

- **Storage:** The cache is stored in the system's temporary directory (`os.tmpdir()`) under `bc_al_upgradeassistant/symbolcache`. It consists of two main files:
  - `symbols.json`: Stores general object information (Name, Type, ID).
  - `procedures.json`: Stores procedures associated with specific objects, keyed by `objectType:objectName`.
- **Initialization:** The cache is initialized (`initialize()`) by ensuring the cache directories exist and loading any previously saved cache data from the JSON files.
- **Data Structure:**
  - `this.symbols`: An object where keys are object names and values are objects containing `{ Type, Id }`.
  - `this.procedures`: An object where keys are strings like `"Table:Customer"` and values are arrays of procedure definitions extracted from that object.

```javascript
// Example structure in symbols.json
{
  "Customer": { "Type": "Table", "Id": 18 },
  "Sales Invoice": { "Type": "Page", "Id": 43 }
  // ...
}

// Example structure in procedures.json
{
  "Table:Customer": [ /* array of procedure details */ ],
  "Codeunit:Sales-Post": [ /* array of procedure details */ ]
  // ...
}
```

### Key Features and Operations

- **Loading/Saving:** `loadCache()` reads the JSON files into memory. `saveCache()` writes the current in-memory cache back to the JSON files.
- **Clearing:** `clearCache()` empties the in-memory cache and saves the empty state.
- **Procedure Access:** `getProcedures(objectType, objectName)` retrieves the list of procedures for a given object. `setProcedures(...)` updates them. `getAllObjectsWithProcedures()` returns a list of all object keys that have associated procedures in the cache.
- **Object Info:** `getObjectInfo(objectName)` retrieves the cached symbol data for an object. `getObjectId(objectName)` is a convenience method to get just the ID.

### Background Refresh Process (`refreshCacheInBackground`)

This is the core function for populating and updating the cache based on `.app` files found in the configured `appPaths`.

1.  **Concurrency Control:** Uses `this.isRefreshing` flag to prevent multiple refresh processes from running simultaneously.
2.  **Worker Processes:** It utilizes Node.js `child_process.fork` to spawn separate worker processes (`src/symbolCacheWorker.js`) for each `.app` file. This prevents the main extension host from blocking during potentially long-running parsing operations.
    - Each worker receives the `.app` path and configuration options (like whether to extract source code).
    - Workers handle `.app` file reading (using `jszip`), symbol/procedure extraction (likely using `al-parser-lib`), and optionally source code extraction if enabled (`enableSrcExtraction` config) and the `srcExtractionPath` is provided.
3.  **Communication:** Workers communicate back to the main `SymbolCache` process using `process.send` and `worker.on('message', ...)`:
    - `success`: Sends extracted symbols and procedures upon successful processing.
    - `error`: Reports errors encountered during processing.
    - `progress`: Sends status updates for display in the VS Code progress notification.
    - `warning`: Reports non-critical issues.
4.  **Aggregation:** The main process collects symbols (`newSymbols`) and procedures (`this.procedures`) from all successful worker messages.
5.  **Cache Update:** Once all workers complete (`Promise.all(workerPromises)`), the main `this.symbols` object is replaced with `newSymbols`, and the combined `this.procedures` are updated. The entire cache is then saved using `saveCache()`.

### Error Handling and Progress Reporting

- **Progress:** Uses `vscode.window.withProgress` to show a cancellable progress notification in the VS Code window, updated via messages from the workers.
- **Worker Errors:** Errors within a worker process are caught and sent back as an 'error' message. The main process logs these errors and shows a `vscode.window.showErrorMessage`, sometimes filtering known non-critical errors (like "is this a zip file?"). Worker exit codes other than 0 also trigger error messages.
- **Main Process Errors:** Errors during file system operations (creating directories, saving cache) or worker management are caught and reported via `console.error` and `vscode.window.showErrorMessage`.
- **Configuration Issues:** Checks for necessary configurations like `appPaths` and `srcExtractionPath` (if source extraction is enabled) and provides warnings if they are missing.
