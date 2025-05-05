const fs = require("fs");
const path = require("path");
const util = require("util");
const JSZip = require("jszip");

const { promises: fsPromises } = require("fs"); // Use fs.promises
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const rmdir = util.promisify(fs.rmdir);

// Import the worker-specific logger that doesn't depend on vscode
const { logger } = require("./utils/workerLogger");

/**
 * Parse AL table content to extract field names
 * @param {string} content - Content of the AL file
 * @returns {Object|null} - Object with tableName and fields array, or null
 */
function extractFieldsFromTableContent(content) {
  try {
    // Skip if not a table definition
    if (!content.includes("table ") && !content.includes("tableextension ")) {
      return null;
    }

    // Extract table name
    let tableName = null;
    let tableMatch = content.match(/table\s+(\d+)\s+["']([^"']+)["']/i);

    if (tableMatch) {
      tableName = tableMatch[2];
    } else {
      // Try tableextension
      tableMatch = content.match(
        /tableextension\s+(\d+)\s+["']([^"']+)["']\s+extends\s+["']([^"']+)["']/i
      );
      if (tableMatch) {
        tableName = tableMatch[3]; // Use the base table name
      }
    }

    if (!tableName) {
      return null;
    }

    // Extract field definitions
    const fields = [];

    // Match field definitions
    const fieldRegex = /field\s*\(\s*\d+\s*;\s*["']([^"']+)["']/gi;
    let match;
    while ((match = fieldRegex.exec(content)) !== null) {
      fields.push(match[1]);
    }

    return { tableName, fields };
  } catch (error) {
    // Log error within worker context if needed
    logger.error(`[Worker] Error extracting fields from content:`, error);
    return null;
  }
}

/**
 * Parse AL page content to extract source table
 * @param {string} content - Content of the AL file
 * @returns {Object|null} - Object with pageName and sourceTable, or null
 */
function extractSourceTableFromPageContent(content) {
  try {
    // Skip if not a page definition
    if (!content.includes("page ")) {
      return null;
    }

    // Extract page name
    const pageMatch = content.match(/page\s+(\d+)\s+["']([^"']+)["']/i);
    if (!pageMatch) {
      return null;
    }

    const pageName = pageMatch[2];

    // Extract source table
    const sourceTableMatch = content.match(
      /SourceTable\s*=\s*["']([^"']+)["']/i
    );
    if (!sourceTableMatch) {
      // It's a page, but might not have a SourceTable (e.g., RoleCenter)
      return { pageName, sourceTable: null }; // Return pageName even without sourceTable
    }

    return {
      pageName,
      sourceTable: sourceTableMatch[1],
    };
  } catch (error) {
    // Log error within worker context if needed
    logger.error(`[Worker] Error extracting source table from content:`, error);
    return null;
  }
}

/**
 * Main function to update the field cache (incremental, persistent)
 * @param {object} options - Options containing paths, appName, etc.
 */
async function _updateFieldsCacheInternal(options) {
  logger.info("[Worker] Starting _updateFieldsCacheInternal...");
  const { srcExtractionPath, globalStoragePath, appName, logLevel } = options;

  // Update log level if provided
  if (logLevel) {
    logger.setLogLevel(logLevel);
  }

  if (!srcExtractionPath || !globalStoragePath || !appName) {
    logger.error("[Worker] Missing required options for field cache update.");
    process.send({
      type: "fieldCacheError",
      message: "Missing required options.",
    });
    return;
  }

  const metadataFilePath = path.join(
    globalStoragePath,
    "fieldCacheMetadata.json"
  );
  const tableCacheFilePath = path.join(
    globalStoragePath,
    "fieldTableCache.json"
  );
  const pageCacheFilePath = path.join(globalStoragePath, "fieldPageCache.json");

  let metadata = {};
  let tableFieldsCache = {};
  let pageSourceTableCache = {};

  // 1. Load existing cache and metadata
  try {
    if (fs.existsSync(metadataFilePath)) {
      metadata = JSON.parse(
        await fsPromises.readFile(metadataFilePath, "utf8")
      );
    }
    if (fs.existsSync(tableCacheFilePath)) {
      tableFieldsCache = JSON.parse(
        await fsPromises.readFile(tableCacheFilePath, "utf8")
      );
    }
    if (fs.existsSync(pageCacheFilePath)) {
      pageSourceTableCache = JSON.parse(
        await fsPromises.readFile(pageCacheFilePath, "utf8")
      );
    }
    logger.info("[Worker] Loaded existing cache/metadata.");
  } catch (err) {
    logger.error("[Worker] Error loading existing cache/metadata:", err);
    // Start fresh if loading fails
    metadata = {};
    tableFieldsCache = {};
    pageSourceTableCache = {};
  }

  const processedFiles = new Set(); // Keep track of files found in this run

  // 2. Scan srcExtractionPath (using async methods)
  try {
    logger.info(`[Worker] Scanning ${srcExtractionPath}...`);
    const scanDirectory = async (dir) => {
      try {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (
            entry.isFile() &&
            entry.name.toLowerCase().endsWith(".al")
          ) {
            processedFiles.add(fullPath); // Track found file
            try {
              const stats = await fsPromises.stat(fullPath);
              const currentMtime = stats.mtimeMs;
              const storedMtime = metadata[fullPath];

              // 3. Compare timestamps and parse if needed
              if (!storedMtime || currentMtime > storedMtime) {
                logger.verbose(
                  `[Worker] Processing modified/new file: ${entry.name}`
                );
                const content = await fsPromises.readFile(fullPath, "utf8");

                // Parse table fields
                const tableResult = extractFieldsFromTableContent(content);
                if (tableResult && tableResult.tableName) {
                  // If table already in cache, combine the fields (handle extensions)
                  if (tableFieldsCache[tableResult.tableName]) {
                    tableFieldsCache[tableResult.tableName] = [
                      ...new Set([
                        ...tableFieldsCache[tableResult.tableName],
                        ...(tableResult.fields || []), // Ensure fields array exists
                      ]),
                    ];
                  } else {
                    tableFieldsCache[tableResult.tableName] =
                      tableResult.fields || [];
                  }
                }

                // Parse page source tables
                const pageResult = extractSourceTableFromPageContent(content);
                if (pageResult && pageResult.pageName) {
                  // Check pageName exists
                  // Only update if sourceTable is found, otherwise keep existing if any
                  if (pageResult.sourceTable !== null) {
                    pageSourceTableCache[pageResult.pageName] =
                      pageResult.sourceTable;
                  } else if (
                    !Object.prototype.hasOwnProperty.call(
                      pageSourceTableCache,
                      pageResult.pageName
                    )
                  ) {
                    // If page has no source table and isn't in cache, add it with null
                    pageSourceTableCache[pageResult.pageName] = null;
                  }
                }

                // Update metadata
                metadata[fullPath] = currentMtime;
              } else {
                // Skipping unchanged file - no need to log at all
              }
            } catch (fileError) {
              logger.error(
                `[Worker] Error processing file ${fullPath}:`,
                fileError
              );
            }
          }
        }
      } catch (scanErr) {
        logger.error(`[Worker] Error scanning directory ${dir}:`, scanErr);
        // Decide if we should stop or continue
      }
    };

    await scanDirectory(srcExtractionPath);
    logger.info("[Worker] Finished scanning.");

    // 4. Identify and remove deleted files from cache/metadata
    let deletedCount = 0;
    for (const filePath in metadata) {
      if (!processedFiles.has(filePath)) {
        logger.verbose(
          `[Worker] Removing deleted file from cache: ${path.basename(
            filePath
          )}`
        );
        delete metadata[filePath];
        // Need to remove associated data from tableFieldsCache and pageSourceTableCache
        // This is complex as one file can contribute to multiple cache entries (e.g., table extensions)
        // For simplicity initially, we might just rebuild fully if deletions are detected,
        // or accept potentially stale data until the next full rebuild/app change.
        // Let's just remove from metadata for now.
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      logger.info(`[Worker] Identified ${deletedCount} deleted files.`);
      // Consider forcing a full rebuild or notifying main thread if deletion handling is critical
    }

    // 5. Save updated cache and metadata
    try {
      await fsPromises.mkdir(globalStoragePath, { recursive: true }); // Ensure directory exists
      await fsPromises.writeFile(
        metadataFilePath,
        JSON.stringify(metadata, null, 2)
      );
      await fsPromises.writeFile(
        tableCacheFilePath,
        JSON.stringify(tableFieldsCache, null, 2)
      );
      await fsPromises.writeFile(
        pageCacheFilePath,
        JSON.stringify(pageSourceTableCache, null, 2)
      );
      logger.info("[Worker] Saved updated cache/metadata.");
    } catch (saveError) {
      logger.error("[Worker] Error saving cache/metadata:", saveError);
      process.send({
        type: "fieldCacheError",
        message: "Failed to save cache data.",
      });
      return; // Don't send success if saving failed
    }

    // 6. Send updated data back to main thread
    process.send({
      type: "fieldCacheData",
      tableFieldsCache,
      pageSourceTableCache,
      metadata, // Send metadata back too, maybe useful for main thread
    });
    logger.info("[Worker] Sent updated fieldCacheData to main thread.");
  } catch (err) {
    logger.error("[Worker] Error during field cache update process:", err);
    process.send({
      type: "fieldCacheError",
      message: `Error updating field cache: ${err.message}`,
    });
  }
}

// Extracted from symbolCache.js, modified for worker context
async function processAppFile(appPath, options) {
  const {
    extractPath,
    enableSrcExtraction,
    srcExtractionPath,
    appCachePath,
    logLevel,
  } = options;

  // Update log level if provided
  if (logLevel) {
    logger.setLogLevel(logLevel);
  }

  const appFileName = path.basename(appPath);
  let extractDir = null; // Declare outside, initialize to null
  let symbols = {}; // Declare outside
  let procedures = {}; // Declare outside
  let alFiles = []; // Declare alFiles outside the if block
  let sourceDir = null; // Declare sourceDir outside

  try {
    // Create app-specific cache directory if it doesn't exist
    if (appCachePath) {
      await mkdir(appCachePath, { recursive: true });
    }

    // Single main try block
    // Create a unique temp directory for this extraction
    extractDir = path.join(extractPath, appFileName.replace(/\./g, "_")); // Assign to outer variable
    // Make sure the extraction directory exists and is empty
    await mkdir(extractDir, { recursive: true });
    process.send({ type: "progress", message: "Reading app file..." });

    // Read the zip file as buffer
    const zipData = await readFile(appPath);
    const zip = await JSZip.loadAsync(zipData);

    process.send({ type: "progress", message: "Extracting files..." });

    // Extract files to extractDir
    await Promise.all(
      Object.keys(zip.files).map(async (filename) => {
        const file = zip.files[filename];
        const filePath = path.join(extractDir, filename);
        if (file.dir) {
          await mkdir(filePath, { recursive: true });
        } else {
          await mkdir(path.dirname(filePath), { recursive: true });
          const content = await file.async("nodebuffer");
          await writeFile(filePath, content);
        }
      })
    );

    process.send({ type: "progress", message: "Processing symbols..." });

    // Extract source files if enabled
    if (enableSrcExtraction && srcExtractionPath) {
      await extractSourceFiles(appPath, zip, srcExtractionPath);
    }

    // Collections are already declared outside

    // First try to load symbols from .al files in srcExtractionPath if enabled
    if (enableSrcExtraction && srcExtractionPath) {
      try {
        const alParser = require("../al-parser-lib/alparser");

        // Calculate the expected source directory path
        const appFileName = path.basename(appPath);
        const nameParts = appFileName.split("_");
        const extractedAppName =
          nameParts.length > 1 ? nameParts[1] || "Unknown" : appFileName;
        let extractedAppVersion = // Use let to allow modification
          nameParts.length > 2 ? nameParts[2] || "1.0" : "1.0";
        // Remove .app extension from version if present
        extractedAppVersion = extractedAppVersion.replace(/\.app$/i, "");
        const sanitizedAppName = extractedAppName.replace(/[<>:"/\\|?*]/g, "_");
        sourceDir = path.join(
          // Assign to outer variable
          srcExtractionPath,
          sanitizedAppName,
          extractedAppVersion
        );

        process.send({
          type: "progress",
          message: "Checking for AL source files...",
        });

        if (fs.existsSync(sourceDir)) {
          // Find all .al files recursively
          const findAlFiles = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            let files = [];
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                files = files.concat(findAlFiles(fullPath));
              } else if (entry.name.endsWith(".al")) {
                files.push(fullPath);
              }
            }
            return files;
          };

          alFiles = findAlFiles(sourceDir); // Assign to the outer variable
          logger.info(
            `[Worker] Found ${alFiles.length} .al files in ${sourceDir}`
          ); // Log found AL files
          process.send({
            type: "progress",
            message: `Found ${alFiles.length} AL files in source dir`,
          });

          // Try to parse each .al file
          let shortFileName = "";
          for (const filePath of alFiles) {
            try {
              const content = fs.readFileSync(filePath, "utf8");
              shortFileName = path.basename(filePath);
              logger.verbose(`[Worker] Processing AL file: ${shortFileName}`); // Log which file is being processed

              if (!alParser.isCAL(content)) {
                const objectDef = alParser.getObjectDefinition(content);
                // Diagnostic log removed
                if (objectDef) {
                  symbols[objectDef.Name] = objectDef;
                  logger.verbose(
                    // Log successful parsing
                    `[Worker] Parsed object: ${objectDef.Type} ${objectDef.Id} "${objectDef.Name}" from ${shortFileName}`
                  );
                  process.send({
                    type: "progress",
                    message: `Loaded ${objectDef.Type} "${objectDef.Name}" from source`,
                  });
                } else {
                  logger.verbose(
                    // Log if parser returned null
                    `[Worker] No object definition returned by parser for: ${shortFileName}`
                  );
                }
              } else {
                logger.verbose(
                  // Log if C/AL detected
                  `[Worker] Skipping C/AL file detection for: ${shortFileName}`
                );
              }
            } catch (err) {
              logger.error(
                // Log parsing errors
                `[Worker] Error parsing AL file ${shortFileName}: ${err.message}`
              );
              process.send({
                type: "warning",
                message: `Failed to parse AL file ${shortFileName}: ${err.message}`,
              });
            }
          }
        }
      } catch (err) {
        process.send({
          type: "warning",
          message: `Error processing AL source files: ${err.message}`,
        });
      }
    }

    // Extract procedures from AL files in srcExtractionPath if enabled
    // Extract procedures from AL files in srcExtractionPath if enabled AND symbols were processed from source
    // Reuse alFiles and sourceDir from the symbol processing block above
    if (
      enableSrcExtraction &&
      srcExtractionPath &&
      fs.existsSync(sourceDir) &&
      alFiles.length > 0
    ) {
      // Check length, alFiles is always defined now
      process.send({
        type: "progress",
        message: `Extracting procedures from ${alFiles.length} source files...`,
      });
      logger.info(
        `[Worker] Using ${alFiles.length} .al files found during symbol parsing for procedure extraction in ${sourceDir}`
      );

      for (const filePath of alFiles) {
        // Use alFiles from symbol parsing
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const shortFileName = path.basename(filePath);
          logger.verbose(
            `[Worker] Processing AL file for procedures: ${shortFileName}`
          );

          // Extract object info using the parser if possible (more robust)
          const alParser = require("../al-parser-lib/alparser"); // Ensure parser is required
          const objectDef = alParser.getObjectDefinition(content);

          if (objectDef) {
            const objectType = objectDef.Type.toLowerCase(); // Use parsed type
            const objectName = objectDef.Name; // Use parsed name

            // Extract global procedures using regex (as parser doesn't provide them)
            const procedureLines = [];
            let inProcedure = false;
            let currentProcedure = null;

            content.split(/\r?\n/).forEach((line) => {
              const trimmedLine = line.trim();

              // Match procedure that doesn't have 'local' before it
              const procMatch = trimmedLine.match(
                /^(?!.*\blocal\s+)procedure\s+["']?([^"'\s(]+)["']?\s*\((.*)\)(?:\s*:\s*([^;]+))?;/i // Adjusted regex slightly for return type
              );

              if (procMatch) {
                // Finish previous procedure if any
                if (currentProcedure) {
                  const procKey = `${currentProcedure.type}:${currentProcedure.objectName}`;
                  procedures[procKey] = procedures[procKey] || [];
                  procedures[procKey].push({
                    name: currentProcedure.name,
                    parameters: currentProcedure.parameters,
                    returnType: currentProcedure.returnType,
                    // body: procedureLines.join("\n"), // Body extraction might be too complex/unreliable with regex
                  });
                }

                // Start new procedure
                currentProcedure = {
                  type: objectType,
                  objectName: objectName,
                  name: procMatch[1],
                  parameters: procMatch[2]
                    ? procMatch[2]
                        .split(";")
                        .map((p) => p.trim())
                        .filter((p) => p)
                    : [], // Handle empty parameters
                  returnType: procMatch[3] ? procMatch[3].trim() : null,
                };
                procedureLines.length = 0;
                // procedureLines.push(line); // Don't store body for now
                inProcedure = true;
              } else if (inProcedure) {
                // procedureLines.push(line); // Don't store body
                // Use a simpler end condition: start of another procedure or end of file
                // The regex match for a new procedure handles the transition.
                // We need to capture the last procedure after the loop.
              }
            });

            // Capture the last procedure after the loop finishes
            if (currentProcedure) {
              const procKey = `${currentProcedure.type}:${currentProcedure.objectName}`;
              procedures[procKey] = procedures[procKey] || [];
              procedures[procKey].push({
                name: currentProcedure.name,
                parameters: currentProcedure.parameters,
                returnType: currentProcedure.returnType,
                // body: procedureLines.join("\n"),
              });
            }
          } else {
            logger.verbose(
              `[Worker] Skipping procedure extraction for ${shortFileName} as object definition was not found.`
            );
          }
        } catch (err) {
          logger.error(
            `[Worker] Error extracting procedures from AL file ${path.basename(
              filePath
            )}: ${err.message}`
          );
          process.send({
            type: "warning",
            message: `Failed to extract procedures from AL file ${path.basename(
              filePath
            )}: ${err.message}`,
          });
        }
      }
    } else if (enableSrcExtraction && srcExtractionPath) {
      // Log why procedure extraction might be skipped if source dir existed but no alFiles were found, or dir didn't exist
      if (!fs.existsSync(sourceDir)) {
        logger.info(
          `[Worker] Source directory for procedures not found: ${sourceDir}`
        );
      } else if (alFiles.length === 0) {
        // Check length explicitly
        logger.info(
          `[Worker] No .al files were found in ${sourceDir} during symbol parsing, skipping procedure extraction.`
        );
      }
    }
    // Send success message at the end of the try block
    process.send({
      type: "success",
      symbols,
      procedures,
      appPath,
    });
  } catch (error) {
    // End of main try block

    // Single catch block for the main try
    process.send({
      type: "error",
      message: error.message,
      stack: error.stack,
      appPath,
    });
  } finally {
    // Single finally block for the main try
    // Clean up extraction directory
    if (extractDir) {
      // Check if extractDir was assigned before removing
      await removeDirectory(extractDir);
    }
  }
}

async function extractSourceFiles(appPath, zip, basePath) {
  try {
    // Safely extract app name/version with early returns for invalid paths
    const fileName = path.parse(appPath).name;
    if (!fileName) {
      return false;
    }

    const nameParts = fileName.split("_");
    const extractedAppName =
      nameParts.length > 1 ? nameParts[1] || "Unknown" : fileName;
    let extractedAppVersion = // Use let to allow modification
      nameParts.length > 2 ? nameParts[2] || "1.0" : "1.0";
    // Remove .app extension from version if present
    extractedAppVersion = extractedAppVersion.replace(/\.app$/i, "");

    // Create sanitized path
    const sanitizedAppName = extractedAppName.replace(/[<>:"/\\|?*]/g, "_");
    const extractDir = path.join(
      basePath,
      sanitizedAppName,
      extractedAppVersion
    );

    // Removed the check that skips extraction if the target directory exists
    // Always proceed to extract/overwrite.

    await mkdir(extractDir, { recursive: true });

    // Store files to extract with their corrected paths
    const sourceFilesToExtract = {};

    // First pass: identify and map all .al files
    for (const filename of Object.keys(zip.files)) {
      const file = zip.files[filename];

      // Skip directories and non-.al files
      if (file.dir || !filename.toLowerCase().endsWith(".al")) continue;

      // Find the last occurrence of '/src/' or check if 'src/' is at the beginning
      const lastSrcIndex = filename.lastIndexOf("/src/");
      let relativePath;

      if (lastSrcIndex !== -1) {
        // Take the part after the last '/src/'
        relativePath = filename.substring(lastSrcIndex + "/src/".length);
      } else if (filename.toLowerCase().startsWith("src/")) {
        // Handle case where it's directly under the first src/
        relativePath = filename.substring("src/".length);
      } else {
        // Skip .al files not under any src folder
        process.send({
          type: "warning",
          message: `Skipping .al file not found under a 'src/' directory: ${filename}`,
        });
        continue;
      }

      // Basic sanitization for relative path (prevent directory traversal)
      relativePath = relativePath
        .replace(/^[/\\]+/, "")
        .replace(/[/\\]\.\.[/\\]/, "");

      if (relativePath) {
        sourceFilesToExtract[relativePath] = file;
      }
    }

    // Second pass: extract the collected source files
    for (const [relativePath, file] of Object.entries(sourceFilesToExtract)) {
      try {
        // Decode the path parts
        const decodedPath = relativePath
          .split("/")
          .map((part) => {
            try {
              return decodeURIComponent(decodeURIComponent(part));
            } catch (_) {
              console.log(_);
              try {
                return decodeURIComponent(part);
              } catch (_) {
                console.log(_);
                return part;
              }
            }
          })
          .join(path.sep);

        const targetPath = path.join(extractDir, decodedPath);

        // Create directory and write file
        await mkdir(path.dirname(targetPath), { recursive: true });
        const content = await file.async("nodebuffer");
        await writeFile(targetPath, content);

        process.send({
          type: "progress",
          message: `Extracted ${path.basename(targetPath)}`,
        });
      } catch (writeError) {
        process.send({
          type: "warning",
          message: `Failed to write extracted file ${relativePath}: ${writeError.message}`,
        });
      }
    }

    process.send({
      type: "progress",
      message: `Source files extracted to ${extractDir}`,
    });
    return true;
  } catch (error) {
    process.send({
      type: "error",
      message: `Failed to extract source files from ${appPath}: ${error.message}`,
    });
    return false;
  }
}

async function removeDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
    logger.error(`Error reading directory ${dir}:`, err);
    return [];
  });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await removeDirectory(fullPath);
    } else {
      await fs.promises.unlink(fullPath).catch((err) => {
        logger.error(`Error removing file ${fullPath}:`, err);
      });
    }
  }

  await rmdir(dir).catch((err) => {
    logger.error(`Error removing directory ${dir}:`, err);
  });
}

// Enhanced error handling for worker process
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception in worker:", error);
  process.send({
    type: "error",
    message: `Uncaught exception in worker: ${error.message}`,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection in worker:", error);
  process.send({
    type: "error",
    message: `Unhandled promise rejection in worker: ${error.message}`,
    stack: error.stack,
  });
  process.exit(1);
});

// Listen for messages from the main process with enhanced error handling
process.on("message", async (message) => {
  try {
    // Handle log level setting
    if (message.type === "setLogLevel" && message.logLevel) {
      logger.setLogLevel(message.logLevel);
      logger.info(`[Worker] Log level set to: ${logger.getLogLevel()}`);
      return;
    }

    if (message.type === "process") {
      // If options include logLevel, update it
      if (message.options && message.options.logLevel) {
        logger.setLogLevel(message.options.logLevel);
        logger.info(`[Worker] Log level set to: ${logger.getLogLevel()}`);
      }

      await processAppFile(message.appPath, message.options);
      // Removed explicit exit - worker should stay alive for more messages
      // process.exit(0);
    } else if (message.type === "updateFieldCache") {
      // If options include logLevel, update it
      if (message.options && message.options.logLevel) {
        logger.setLogLevel(message.options.logLevel);
        logger.info(`[Worker] Log level set to: ${logger.getLogLevel()}`);
      }

      logger.info("[Worker] Received updateFieldCache message");
      await _updateFieldsCacheInternal(message.options);
      // Potentially send completion message or exit differently?
      // For now, let's assume it completes and stays alive for other tasks.
      // process.exit(0); // Might not want to exit if worker handles multiple tasks
    }
  } catch (error) {
    logger.error("Unhandled error in worker:", error);
    process.send({
      type: "error",
      message: `Unhandled error in worker: ${error.message}`,
      stack: error.stack,
      appPath: message.appPath,
    });
    process.exit(1);
  }
});
