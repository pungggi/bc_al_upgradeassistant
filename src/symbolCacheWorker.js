const fs = require("fs");
const path = require("path");
const util = require("util");
const JSZip = require("jszip");

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const rmdir = util.promisify(fs.rmdir);

// Extracted from symbolCache.js, modified for worker context
async function processAppFile(appPath, options) {
  const { extractPath, enableSrcExtraction, srcExtractionPath } = options;

  const appFileName = path.basename(appPath);
  let extractDir = null; // Declare outside, initialize to null
  let symbols = {}; // Declare outside
  let procedures = {}; // Declare outside
  let alFiles = []; // Declare alFiles outside the if block
  let sourceDir = null; // Declare sourceDir outside

  try {
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
          console.log(
            `[Worker] Found ${alFiles.length} .al files in ${sourceDir}`
          ); // Log found AL files
          process.send({
            type: "progress",
            message: `Found ${alFiles.length} AL files in source dir`,
          });

          // Try to parse each .al file
          for (const filePath of alFiles) {
            try {
              const content = fs.readFileSync(filePath, "utf8");
              const shortFileName = path.basename(filePath);
              console.log(`[Worker] Processing AL file: ${shortFileName}`); // Log which file is being processed

              if (!alParser.isCAL(content)) {
                const objectDef = alParser.getObjectDefinition(content);
                // Diagnostic log removed
                if (objectDef) {
                  symbols[objectDef.Name] = objectDef;
                  console.log(
                    // Log successful parsing
                    `[Worker] Parsed object: ${objectDef.Type} ${objectDef.Id} "${objectDef.Name}" from ${shortFileName}`
                  );
                  process.send({
                    type: "progress",
                    message: `Loaded ${objectDef.Type} "${objectDef.Name}" from source`,
                  });
                } else {
                  console.log(
                    // Log if parser returned null
                    `[Worker] No object definition returned by parser for: ${shortFileName}`
                  );
                }
              } else {
                console.log(
                  // Log if C/AL detected
                  `[Worker] Skipping C/AL file detection for: ${shortFileName}`
                );
              }
            } catch (err) {
              console.error(
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
      console.log(
        `[Worker] Using ${alFiles.length} .al files found during symbol parsing for procedure extraction in ${sourceDir}`
      );

      for (const filePath of alFiles) {
        // Use alFiles from symbol parsing
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const shortFileName = path.basename(filePath);
          console.log(
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
            console.log(
              `[Worker] Skipping procedure extraction for ${shortFileName} as object definition was not found.`
            );
          }
        } catch (err) {
          console.error(
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
        console.log(
          `[Worker] Source directory for procedures not found: ${sourceDir}`
        );
      } else if (alFiles.length === 0) {
        // Check length explicitly
        console.log(
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
    console.error(`Error reading directory ${dir}:`, err);
    return [];
  });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await removeDirectory(fullPath);
    } else {
      await fs.promises.unlink(fullPath).catch((err) => {
        console.error(`Error removing file ${fullPath}:`, err);
      });
    }
  }

  await rmdir(dir).catch((err) => {
    console.error(`Error removing directory ${dir}:`, err);
  });
}

// Enhanced error handling for worker process
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception in worker:", error);
  process.send({
    type: "error",
    message: `Uncaught exception in worker: ${error.message}`,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection in worker:", error);
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
    if (message.type === "process") {
      await processAppFile(message.appPath, message.options);
      // Explicit successful exit
      process.exit(0);
    }
  } catch (error) {
    console.error("Unhandled error in worker:", error);
    process.send({
      type: "error",
      message: `Unhandled error in worker: ${error.message}`,
      stack: error.stack,
      appPath: message.appPath,
    });
    process.exit(1);
  }
});
