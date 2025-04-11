# Field Cache Refactoring Plan

**Goal:** Improve the performance and responsiveness of the `bc-al-upgradeassistant` extension's field cache update process by making it asynchronous, incremental, and persistent.

**Current Issues:**

1.  **Blocking Activation:** Synchronous file operations (`glob.sync`, `fs.readFileSync`) in `updateFieldsCache` block the Node.js event loop, delaying extension activation.
2.  **Inefficient Caching:** The cache update re-scans and re-parses all `.al` files in `srcExtractionPath` on every run, without differentiating between workspace/dependency files or checking for modifications.

**Refined Plan:**

1.  **Integrate into Worker (`src/symbolCacheWorker.js`):**

    - Move the core field cache building logic (functions like `updateFieldsCache`, `extractFieldsFromTableFile`, `extractSourceTableFromPageFile`, etc.) from `src/utils/fieldCollector.js` into the existing worker script `src/symbolCacheWorker.js`.
    - Adapt these functions to use asynchronous file operations (`fs.promises.readFile`, `fs.promises.stat`) and potentially `vscode.workspace.findFiles` for scanning.

2.  **Asynchronous Communication:**

    - Define worker message types (e.g., `updateFieldCache`, `fieldCacheData`).
    - Modify the main extension thread (likely in `src/extension.js` or `src/utils/cacheHelper.js`) to:
      - Read the workspace app name from `app.json` upon activation.
      - Send an `updateFieldCache` message to the worker, including the app name. This message initiates the cache update process in the background.
      - Listen for `fieldCacheData` messages from the worker.

3.  **Persistence:**

    - **Location:** Use the extension's global storage context (e.g., `context.globalStorageUri`) to store the cache files (e.g., `fieldTableCache.json`, `fieldPageCache.json`, `fieldCacheMetadata.json`).
    - **Loading:** On activation, before triggering the worker, attempt to load the persisted cache data and metadata from these files into the in-memory variables (`tableFieldsCache`, `pageSourceTableCache`, and a new metadata variable) in `src/utils/fieldCollector.js`.
    - **Saving:** When the main thread receives the updated `fieldCacheData` from the worker, update the in-memory variables and asynchronously write the new cache data and metadata back to the persistence files.

4.  **Incremental Update Logic (in Worker):**

    - When the worker receives `updateFieldCache`:
      - Load the persisted metadata (mapping file paths to last modified timestamps).
      - Scan the `srcExtractionPath`.
      - For each `.al` file found:
        - Get its modification time (`mtime`).
        - Compare `mtime` with the stored timestamp in the metadata.
        - **Identify Source:** Determine if the file belongs to the workspace (folder name matches the provided app name) or a dependency (other subfolders).
        - **Parse Condition:** Only re-parse the file if it's new or its `mtime` is newer than the stored timestamp. _Initially, apply this logic to both workspace and dependency files._
        - Update the cache data (tables, pages) and the metadata with the new `mtime` if parsed.
      - Identify deleted files (in metadata but not found in scan) and remove them from the cache data and metadata.
      - Send the complete, updated cache data and metadata back to the main thread.

5.  **Triggering Updates:**
    - The initial cache update is triggered on extension activation.
    - File watchers for `.al` files in the workspace should also trigger the `updateFieldCache` message to the worker.
    - The existing watcher for `.app` files (which triggers `initializeSymbolCache`) should _also_ trigger the `updateFieldCache` message to ensure fields are updated when dependencies change.

**Visual Plan:**

```mermaid
graph TD
    subgraph Initialization
        Init1[Extension Activate] --> Init6[Read app.json Name];
        Init6 --> Init2{Load Persisted Cache?};
        Init2 -- Yes --> Init3[Load Cache & Metadata from Disk];
        Init2 -- No/Error --> Init4[Start Empty];
        Init3 --> Init5[In-Memory Cache Ready];
        Init4 --> Init5;
        Init5 --> Init7[Trigger Worker: updateFieldCache(AppName)];
    end

    subgraph Worker: updateFieldCache
        W1[Receive updateFieldCache(AppName)] --> W2[Load Persisted Metadata];
        W2 --> W3[Scan srcExtractionPath (Async)];
        W3 --> W4{For Each File};
        W4 -- File --> W5[Get mtime];
        W5 --> W6{Compare mtime vs Metadata};
        W6 -- New/Modified --> W8[Parse File (Async)];
        W8 --> W9[Update Cache Data];
        W9 --> W10[Update Metadata (mtime)];
        W6 -- Unchanged --> W10;
        W4 -- Done --> W11[Identify Deleted Files];
        W11 --> W12[Remove from Cache Data & Metadata];
        W12 --> W13[Send fieldCacheData to Main Thread];
    end

    subgraph Main Thread: Handle Worker Result
        M1[Receive fieldCacheData] --> M2[Update In-Memory Cache];
        M2 --> M3[Save Cache Data & Metadata to Disk (Async)];
    end

    subgraph File Watchers
        FW1[Workspace .al Change] --> Init6B[Get App Name] --> FW2[Trigger Worker: updateFieldCache(AppName)];
        FW3[.app Change] --> FW4[Trigger Symbol Cache Update];
         FW4 --> Init6C[Get App Name] --> FW5[Trigger Worker: updateFieldCache(AppName)];
    end

    Init7 --> W1;
    W13 --> M1;
    FW2 --> W1;
    FW5 --> W1;
```

**Benefits:**

- Faster extension activation.
- More responsive UI during cache updates.
- Reduced redundant processing, leading to faster cache updates overall.
- Faster subsequent activations due to persisted cache.
