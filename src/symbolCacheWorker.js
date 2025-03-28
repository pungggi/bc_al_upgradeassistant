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

  try {
    // Create a unique temp directory for this extraction
    const appFileName = path.basename(appPath);
    const extractDir = path.join(extractPath, appFileName.replace(/\./g, "_"));

    try {
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

      // Search for SymbolReference.json in the extracted files
      const symbolFilePath = await findSymbolReferenceFile(extractDir);

      if (!symbolFilePath) {
        process.send({
          type: "error",
          message: `No SymbolReference.json found in ${appPath}`,
        });
        return;
      }

      // Read the symbol file with improved error handling
      const buffer = await readFile(symbolFilePath, "utf8");

      // Check for BOM and skip if present
      let content = buffer.toString("utf8");
      if (content.charCodeAt(0) === 0xfeff) {
        content = content.substring(1);
      }

      // Parse JSON content
      let symbolData;
      try {
        symbolData = JSON.parse(content);
      } catch (initialParseError) {
        // Try to sanitize the content by finding the outermost valid JSON structure
        const match = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (match) {
          symbolData = JSON.parse(match[0]);
        } else {
          throw initialParseError;
        }
      }

      // Process symbol data
      const symbols = {};
      const procedures = {};

      if (symbolData) {
        ["Tables", "Pages", "Reports"].forEach((type) => {
          if (Array.isArray(symbolData[type])) {
            symbolData[type].forEach((obj) => {
              if (obj.Name) {
                symbols[obj.Name] = obj;
              }
            });
          }
        });
      }

      // Extract procedures from AL files in src directory
      const srcDir = path.join(extractDir, "src");
      if (fs.existsSync(srcDir)) {
        const files = await readdir(srcDir);
        for (const file of files) {
          if (file.endsWith(".al")) {
            const filePath = path.join(srcDir, file);
            const content = await readFile(filePath, "utf8");

            // Extract object info from the file
            const objectMatch = content.match(
              /\b(table|page|codeunit|report|query|xmlport)\s+(\d+)\s+["']([^"']+)["']/i
            );

            if (objectMatch) {
              const objectType = objectMatch[1].toLowerCase();
              const objectName = objectMatch[3];

              // Extract global procedures
              const procedureLines = [];
              let inProcedure = false;
              let currentProcedure = null;

              content.split(/\r?\n/).forEach((line) => {
                const trimmedLine = line.trim();

                // Match procedure that doesn't have 'local' before it
                const procMatch = trimmedLine.match(
                  /^(?!.*\blocal\s+)procedure\s+["']?([^"'\s(]+)["']?\s*\((.*)\)(:\s*(.+))?;/i
                );

                if (procMatch) {
                  if (currentProcedure) {
                    procedures[
                      `${currentProcedure.type}:${currentProcedure.objectName}`
                    ] =
                      procedures[
                        `${currentProcedure.type}:${currentProcedure.objectName}`
                      ] || [];
                    procedures[
                      `${currentProcedure.type}:${currentProcedure.objectName}`
                    ].push({
                      name: currentProcedure.name,
                      parameters: currentProcedure.parameters,
                      returnType: currentProcedure.returnType,
                      body: procedureLines.join("\n"),
                    });
                  }

                  currentProcedure = {
                    type: objectType,
                    objectName: objectName,
                    name: procMatch[1],
                    parameters: procMatch[2]
                      .split(",")
                      .map((p) => p.trim())
                      .filter((p) => p),
                    returnType: procMatch[4] ? procMatch[4].trim() : null,
                  };
                  procedureLines.length = 0;
                  procedureLines.push(line);
                  inProcedure = true;
                } else if (inProcedure) {
                  procedureLines.push(line);
                  if (trimmedLine.toLowerCase() === "end;") {
                    procedures[
                      `${currentProcedure.type}:${currentProcedure.objectName}`
                    ] =
                      procedures[
                        `${currentProcedure.type}:${currentProcedure.objectName}`
                      ] || [];
                    procedures[
                      `${currentProcedure.type}:${currentProcedure.objectName}`
                    ].push({
                      name: currentProcedure.name,
                      parameters: currentProcedure.parameters,
                      returnType: currentProcedure.returnType,
                      body: procedureLines.join("\n"),
                    });
                    currentProcedure = null;
                    inProcedure = false;
                    procedureLines.length = 0;
                  }
                }
              });
            }
          }
        }
      }

      // Send back the processed symbols and procedures
      process.send({
        type: "success",
        symbols,
        procedures,
        appPath,
      });
    } finally {
      // Clean up extraction directory
      await removeDirectory(extractDir);
    }
  } catch (error) {
    process.send({
      type: "error",
      message: error.message,
      stack: error.stack,
      appPath,
    });
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
    const extractedAppVersion =
      nameParts.length > 2 ? nameParts[2] || "1.0" : "1.0";

    // Create sanitized path
    const sanitizedAppName = extractedAppName.replace(/[<>:"/\\|?*]/g, "_");
    const extractDir = path.join(
      basePath,
      sanitizedAppName,
      extractedAppVersion
    );

    // Skip if target already has AL files
    if (fs.existsSync(extractDir)) {
      const files = await readdir(extractDir);
      if (files.some((file) => file.endsWith(".al"))) {
        return true;
      }
    }

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

async function findSymbolReferenceFile(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recursively search subdirectories
      const found = await findSymbolReferenceFile(fullPath);
      if (found) return found;
    } else if (entry.name === "SymbolReference.json") {
      return fullPath;
    }
  }

  return null;
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
