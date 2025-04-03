# Refactoring Plan: Symbol Cache Workflow

## Task

Ensure and refactor if necessary the workflow for generating `procedures.json` and `symbols.json`:

1.  Check and read `.app` files.
2.  Extract source code from `.app` files to a designated `srcExtractionPath`.
3.  Generate `symbols.json` and `procedures.json` from the extracted source code.
4.  Ensure step 2 (extraction) happens even if steps 1 and 2 were skipped initially before attempting step 3.

## Current Workflow Analysis

Based on analysis of `src/symbolCache.js` and `src/symbolCacheWorker.js`:

1.  **Initiation (`symbolCache.js`):**
    - Gets `.app` paths and configuration (`enableSrcExtraction`, `srcExtractionPath`).
    - **Potential Skip 1:** Checks if the target extraction directory in `srcExtractionPath` already exists and has `.al` files (`checkIfAppCanBeSkipped`). If so, it skips launching the worker process entirely for that `.app` file.
    - Launches a worker (`symbolCacheWorker.js`) for each `.app` file _not_ skipped.
2.  **Worker Process (`symbolCacheWorker.js`):**
    - Receives the `.app` path and options.
    - Reads the `.app` file (zip).
    - Extracts _all_ contents to a _temporary_ directory (cleaned up afterwards).
    - **Persistent Extraction (Step 2):** If `enableSrcExtraction` is true, it calls `extractSourceFiles`.
      - **Potential Skip 2:** `extractSourceFiles` checks if the target directory in `srcExtractionPath` exists and has `.al` files. If so, it _skips_ extracting the `.al` files from the zip to the persistent `srcExtractionPath`.
      - Otherwise, it extracts `.al` files from `src/` folders within the zip to the persistent `srcExtractionPath`.
    - **Symbol Generation (Step 3a):** If `enableSrcExtraction` is true, it attempts to parse `.al` files found in the _persistent_ `srcExtractionPath` using `al-parser-lib` to generate `symbols.json` data.
    - **Procedure Generation (Step 3b):** It _always_ attempts to parse `.al` files from the _temporary_ extraction's `src/` directory using regex to generate `procedures.json` data.
    - Sends results (symbols, procedures) back to the main process.
3.  **Aggregation (`symbolCache.js`):**
    - Collects results from workers.
    - Saves aggregated `symbols.json` and `procedures.json` to the cache path.

## Issues Identified

1.  **Robustness Gap:** The primary requirement ("ensure step 2 happens before step 3, even if skipped initially") is not fully met. Both "Potential Skip 1" and "Potential Skip 2" can prevent the persistent extraction (Step 2) from running, but symbol generation (Step 3a) might still proceed using potentially stale files already present in `srcExtractionPath`.
2.  **Inconsistent Sources:** Symbols are generated from the persistent `srcExtractionPath` (if enabled), while procedures are generated from the temporary extraction path. This is inconsistent.
3.  **Redundant Skipping:** The skipping logic exists in both the main process and the worker, adding complexity.

## Proposed Refactoring Plan

1.  **Eliminate Main Skip:** Remove the `checkIfAppCanBeSkipped` logic from `symbolCache.js`. The worker process should _always_ be launched for each `.app` file during a refresh.
2.  **Ensure Extraction in Worker:** Modify the `extractSourceFiles` function within `symbolCacheWorker.js`:
    - Remove the check that skips extraction based on the existence of the target directory.
    - Always attempt to extract the `.al` files from the zip to the persistent `srcExtractionPath` when `enableSrcExtraction` is true (overwriting existing files).
3.  **Consolidate Generation Source:** Modify the worker (`symbolCacheWorker.js`) to generate _both_ symbols and procedures from the same source location:
    - When `enableSrcExtraction` is true, parse both symbols and procedures from the `.al` files located in the _persistent_ `srcExtractionPath` directory.
    - **Enhancement:** Refactor the procedure extraction logic to use `al-parser-lib` if possible, otherwise use regex but still read from `srcExtractionPath`.
    - When `enableSrcExtraction` is false, neither symbols nor procedures should be generated from source.
4.  **Cleanup:** Remove the now-unused `checkIfAppCanBeSkipped` function from `symbolCache.js`.

## Visualized Plan (Mermaid Diagram)

```mermaid
graph TD
    A[Start Cache Refresh in symbolCache.js] --> B{Loop through appPaths};
    B --> C{Get enableSrcExtraction & srcExtractionPath};
    C --> D[Fork symbolCacheWorker.js for appPath (No Skipping Here)];

    subgraph Worker Process (symbolCacheWorker.js)
        E[Receive appPath & options] --> F[Read .app (Zip)];
        F --> G[Extract ALL to Temp Dir (for potential internal use, cleaned up later)];
        G --> H{options.enableSrcExtraction?};
        H -- Yes --> I[Call extractSourceFiles];
        H -- No --> J[Skip Persistent Extraction & Source Parsing];

        subgraph extractSourceFiles
            I --> I1[Calculate Target Dir in srcExtractionPath];
            I1 --> I2[Extract .al files from Zip to Target Dir (Overwrite)]; % Ensures Step 2 happens
        end

        I2 --> K{options.enableSrcExtraction?}; % Check again after extraction attempt
        J --> K;
        K -- Yes --> L[Parse Symbols from srcExtractionPath using al-parser];
        K -- No --> M[symbols = {}]; % No symbols from source

        L --> N{options.enableSrcExtraction?}; % Check again
        M --> N;
        N -- Yes --> O[Parse Procedures from srcExtractionPath (ideally using al-parser)];
        N -- No --> P[procedures = {}]; % No procedures from source

        O --> Q[Send Success (Symbols, Procedures)];
        P --> Q;
        L --> Q; % If procedure parsing skipped/failed but symbols succeeded
        M --> Q; % If both skipped
    end

    D --> R[Receive Worker Result];
    R --> S{Aggregate Results};
    S --> T[Save symbols.json & procedures.json];
```

## Summary of Changes

- Workers are always started.
- Persistent extraction (`srcExtractionPath`) always runs (overwriting) if enabled.
- Both symbols and procedures are generated from the persistent `srcExtractionPath` if enabled.
- Procedure parsing ideally uses the same parser as symbols.
