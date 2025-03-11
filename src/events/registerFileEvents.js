const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const configManager = require("../utils/configManager");
const { convertToAbsolutePath, fileEvents } = require("../utils/alFileSaver");
const { parseCALToJSON } = require("../utils/calParser");
const documentationHelper = require("../utils/documentationHelper");
const alCodeFilter = require("../utils/alCodeFilter");

function createIndexFolder() {
  try {
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (upgradedObjectFolders && upgradedObjectFolders.basePath) {
      const indexFolderPath = path.join(
        upgradedObjectFolders.basePath,
        ".index"
      );
      if (!fs.existsSync(indexFolderPath)) {
        fs.mkdirSync(indexFolderPath, { recursive: true });
        console.log(`Created index folder at: ${indexFolderPath}`);
      }
    }
  } catch (error) {
    console.error("Error creating index folder:", error);
  }
}

/**
 * Updates the index for AL files by processing either a single file or scanning an entire directory
 * @param {Object} [fileInfo] - Information about the specific file to process
 * @returns {void}
 * @throws {Error} When file processing fails or configuration is invalid
 * @description
 * This function maintains an index of AL files by:
 * 1. Processing a single AL file if fileInfo is provided
 * 2. Scanning all AL files in the base directory if no fileInfo is provided
 * The index is stored in a .index directory within the configured base path
 * Each AL object gets its own folder structure: .index/[objectType]/[objectNumber]/
 */
function updateFileIndex(fileInfo) {
  try {
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
      console.warn("Base path not configured for upgraded objects");
      return;
    }

    const basePath = upgradedObjectFolders.basePath;
    const indexPath = path.join(basePath, ".index");

    // If we have specific file info, just process that file
    if (fileInfo && fileInfo.path) {
      if (path.extname(fileInfo.path).toLowerCase() === ".al") {
        processAlFile(fileInfo.path, indexPath, fileInfo.orginFilePath);
      }
    } else {
      // Otherwise, scan all .al files in the base directory
      deepScanForAlFiles(basePath, indexPath);
    }
  } catch (error) {
    console.error("Error updating file index:", error);
  }
}

function deepScanForAlFiles(basePath, indexPath) {
  try {
    walkDirectoryForAlFiles(basePath, basePath, indexPath);
  } catch (error) {
    console.error(`Error scanning for .al files in ${basePath}:`, error);
  }
}

/**
 * Recursively walks through a directory structure to find and process AL files
 * @param {string} currentPath - The directory path currently being processed
 * @param {string} basePath - The root directory path of the project
 * @param {string} indexPath - The path to the index directory where metadata will be stored
 * @returns {void}
 * @throws {Error} When directory reading fails or there's an error walking the directory
 * @description
 * This function recursively traverses the directory structure starting from currentPath,
 * skipping the index directory, and processes all .al files it finds by calling processAlFile()
 */
function walkDirectoryForAlFiles(currentPath, basePath, indexPath) {
  try {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      // Skip the .index directory
      if (entry.isDirectory() && fullPath !== indexPath) {
        // Recursively walk subdirectories
        walkDirectoryForAlFiles(fullPath, basePath, indexPath);
      } else if (
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === ".al"
      ) {
        // Process .al files
        processAlFile(fullPath, indexPath, "orginFilePath");
      }
    }
  } catch (error) {
    console.error(`Error walking directory ${currentPath}:`, error);
  }
}

/**
 * Processes an AL file by extracting object information and creating an index entry
 * @param
 * @param {string} indexPath - The path to the index directory where metadata will be stored
 * @throws {Error} When file reading or processing fails
 */
function processAlFile(filePath, indexPath, orginFilePath) {
  try {
    // Read the file content
    const content = fs.readFileSync(filePath, "utf8");

    // Extract object type and number using regex
    // This regex should match all AL object types
    const objectTypeRegex =
      /\b(table|tableextension|page|pageextension|report|reportextension|codeunit|query|xmlport|enum|enumextension|profile|interface)\b\s+(\d+)\s+["']([^"']+)["']/i;
    const objectMatch = content.match(objectTypeRegex);

    if (!objectMatch) {
      console.warn(
        `Could not determine object type and number for ${filePath}`
      );
      return;
    }

    const objectType = objectMatch[1].toLowerCase();
    const objectNumber = objectMatch[2];

    // Create object type folder
    const objectTypeFolder = path.join(indexPath, objectType);
    if (!fs.existsSync(objectTypeFolder)) {
      fs.mkdirSync(objectTypeFolder, { recursive: true });
    }

    // Create object number folder
    const objectNumberFolder = path.join(objectTypeFolder, objectNumber);
    if (!fs.existsSync(objectNumberFolder)) {
      fs.mkdirSync(objectNumberFolder, { recursive: true });
    }

    // Create file information to store
    const fileInfo = {
      originalPath: filePath,
      fileName: path.basename(filePath),
      objectType,
      objectNumber,
      indexedAt: new Date().toISOString(),
      referencedMigrationFiles:
        orginFilePath && orginFilePath !== "orginFilePath"
          ? [orginFilePath]
          : [],
    };

    // Save file info to index
    fs.writeFileSync(
      path.join(objectNumberFolder, "info.json"),
      JSON.stringify(fileInfo, null, 2),
      "utf8"
    );

    console.log(`Indexed ${objectType} ${objectNumber} from ${filePath}`);

    // Create migration object reference file
    if (
      orginFilePath &&
      typeof orginFilePath === "string" &&
      orginFilePath !== "orginFilePath"
    ) {
      const sourceFileName = path.basename(orginFilePath);

      // Extract object type and number from file name (e.g., "Page5_Currencies.txt", "Table27_Item.txt")
      const sourceFileNameMatch = sourceFileName.match(
        /^([a-zA-Z]+)(\d+)_.+\.txt$/
      );

      if (sourceFileNameMatch) {
        // Create JSON filename based on source file name (replacing .txt with .json)
        const referenceFileName = sourceFileName.replace(/\.txt$/, ".json");
        const referenceFilePath = path.join(indexPath, referenceFileName);

        let referenceData = {
          referencedWorkingObjects: [],
        };

        // If file exists, read current data
        if (fs.existsSync(referenceFilePath)) {
          try {
            referenceData = JSON.parse(
              fs.readFileSync(referenceFilePath, "utf8")
            );
          } catch (parseError) {
            console.error(
              `Error parsing existing reference file ${referenceFilePath}:`,
              parseError
            );
          }
        }

        // Add current object reference if not already in the array
        const objectReference = { type: objectType, number: objectNumber };
        const exists = referenceData.referencedWorkingObjects.some(
          (ref) => ref.type === objectType && ref.number === objectNumber
        );

        if (!exists) {
          referenceData.referencedWorkingObjects.push(objectReference);

          // Write back to file
          fs.writeFileSync(
            referenceFilePath,
            JSON.stringify(referenceData, null, 2),
            "utf8"
          );

          console.log(
            `Updated migration reference in ${referenceFileName} for ${objectType} ${objectNumber}`
          );
        }
      } else {
        console.warn(
          `Could not extract object type and number from migration filename: ${sourceFileName}`
        );
      }
    }
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

/**
 * Formats documentation text as AL comments
 * @param {string} documentation - The documentation text to format
 * @returns {string} - Formatted AL comments
 */
function formatAsComments(documentation) {
  if (!documentation) {
    return "";
  }

  // Split the documentation into lines
  const lines = documentation.split(/\r?\n/);

  // Format each line as an AL comment
  const commentedLines = lines.map((line) => {
    if (line.trim() === "") {
      return "//";
    }
    return `// ${line.trimStart()}`;
  });

  return commentedLines.join("\n");
}

/**
 * Filters documentation lines based on configured documentation IDs
 * @param {string} documentation - The documentation text to filter
 * @returns {string} - Filtered documentation text
 */
function filterDocumentationByIds(documentation) {
  if (!documentation) {
    return "";
  }

  // Get configured documentation IDs
  const docIds = configManager.getMergedDocumentationIds();
  if (!docIds || docIds.length === 0) {
    return documentation; // Return all documentation if no IDs are configured
  }

  // Create regex pattern from documentation IDs
  const { regex } = documentationHelper.createDocumentationRegex(docIds);
  if (!regex) {
    return documentation; // Return all documentation if no valid pattern
  }

  // Filter content using the regex
  return documentationHelper.filterContentByDocumentationIds(
    documentation,
    regex
  );
}

function postCorrections(fileInfo) {
  try {
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (!upgradedObjectFolders || !upgradedObjectFolders.basePath) {
      console.warn("Base path not configured for upgraded objects");
      return;
    }

    const basePath = upgradedObjectFolders.basePath;
    const indexPath = path.join(basePath, ".index");

    // If we have specific file info, just process that file
    if (
      !fileInfo?.path ||
      path.extname(fileInfo.path).toLowerCase() !== ".al"
    ) {
      return;
    }

    // Extract object information from the AL file
    const content = fs.readFileSync(fileInfo.path, "utf8");
    const objectTypeRegex =
      /\b(table|tableextension|page|pageextension|report|reportextension|codeunit|query|xmlport|enum|enumextension|profile|interface)\b\s+(\d+)\s+["']([^"']+)["']/i;
    const objectMatch = content.match(objectTypeRegex);

    if (!objectMatch) {
      console.warn(
        `Could not determine object type and number for ${fileInfo.path}`
      );
      return;
    }

    const objectType = objectMatch[1].toLowerCase();
    const objectNumber = objectMatch[2];

    // Check if there's an original file path
    if (!fileInfo.orginFilePath) {
      // Try to find a reference in the index
      const objectTypeFolder = path.join(indexPath, objectType);
      const objectNumberFolder = path.join(objectTypeFolder, objectNumber);

      if (!fs.existsSync(path.join(objectNumberFolder, "info.json"))) {
        return;
      }

      // Try to read the info.json file to get the reference to the original file
      const infoJson = JSON.parse(
        fs.readFileSync(path.join(objectNumberFolder, "info.json"), "utf8")
      );

      if (
        !infoJson.referencedMigrationFiles ||
        infoJson.referencedMigrationFiles.length === 0
      ) {
        return;
      }

      fileInfo = {
        ...fileInfo,
        orginFilePath: infoJson.referencedMigrationFiles[0],
      };
    }

    // If we have a path to the original C/AL file, try to extract documentation
    if (!fileInfo.orginFilePath || !fs.existsSync(fileInfo.orginFilePath)) {
      return;
    }

    // Read and parse the original C/AL file
    const calCode = fs.readFileSync(fileInfo.orginFilePath, "utf8");
    const parsedCal = parseCALToJSON(calCode);

    insertDocumentationTrigger(parsedCal, fileInfo, content);
    assignAvailableObjectNumber(fileInfo, content, objectType, objectNumber);
  } catch (error) {
    console.error("Error in postCorrections:", error);
  }
}

function insertDocumentationTrigger(parsedCal, fileInfo, content) {
  let documentation = parsedCal.documentation;

  if (!documentation) {
    return;
  }

  // Filter only Documentation comments with documentationId configured in documentationIds
  documentation = filterDocumentationByIds(documentation);
  if (!documentation) {
    console.log(`No relevant documentation found for ${fileInfo.path}`);
    return;
  }

  // Format the documentation as AL comments
  const commentedDocumentation = formatAsComments(documentation);

  // Check if file already has the documentation comments
  if (content.includes(commentedDocumentation)) {
    console.log(`File ${fileInfo.path} already has documentation comments`);
    return;
  }

  // Find the first opening curly brace and insert the documentation after it
  const firstBraceIndex = content.indexOf("{");
  if (firstBraceIndex !== -1) {
    const updatedContent =
      content.substring(0, firstBraceIndex + 1) +
      "\n" +
      commentedDocumentation +
      "\n" +
      content.substring(firstBraceIndex + 1);
    fs.writeFileSync(fileInfo.path, updatedContent, "utf8");
  }
}

/**
 * Assigns an available object number to the AL file being processed
 * @param {Object} fileInfo - Information about the file being processed
 * @returns {boolean} - Whether the number was updated successfully
 */
function assignAvailableObjectNumber(
  fileInfo,
  content,
  objectType,
  currentObjectNumber
) {
  try {
    if (
      !fileInfo?.path ||
      path.extname(fileInfo.path).toLowerCase() !== ".al"
    ) {
      return false;
    }

    // Get the ID ranges from app.json
    const idRanges = alCodeFilter.getIdRangesFromAppJson();

    // If no ID ranges found, use default values
    let minNumber = 50000;
    let maxNumber = 99999;

    if (idRanges && idRanges.length > 0) {
      // Find the minimum and maximum values from all ID ranges
      minNumber = Math.min(...idRanges.map((range) => range.from));
      maxNumber = Math.max(...idRanges.map((range) => range.to));
    } else {
      console.log(
        "No ID ranges found in app.json, using default range (50000-99999)"
      );
    }

    // Get paths to scan for existing object numbers
    const workingObjectFolders = configManager.getConfigValue(
      "workingObjectFolders",
      null
    );

    // Find the target path for this object type
    const targetFolder = convertToAbsolutePath(
      workingObjectFolders[objectType]
    );

    if (!fs.existsSync(targetFolder)) {
      console.warn(
        `Target path for ${objectType} does not exist: ${targetFolder}`
      );
      return false;
    }

    // Set to track used object numbers
    const usedNumbers = new Set();

    // Walk through all files in target path
    const files = fs.readdirSync(targetFolder);
    for (const file of files) {
      // Skip the current file
      if (path.join(targetFolder, file) === fileInfo.path) {
        continue;
      }

      if (path.extname(file).toLowerCase() === ".al") {
        try {
          const fileContent = fs.readFileSync(
            path.join(targetFolder, file),
            "utf8"
          );
          const match = fileContent.match(
            new RegExp(`\\b${objectType}\\b\\s+(\\d+)\\s+["']`, "i")
          );

          if (match && match[1]) {
            usedNumbers.add(parseInt(match[1], 10));
          }
        } catch (err) {
          console.error(`Error reading file ${file}:`, err);
        }
      }
    }

    // If current number is not used by other files, keep it
    if (
      currentObjectNumber >= minNumber &&
      currentObjectNumber <= maxNumber &&
      !usedNumbers.has(currentObjectNumber)
    ) {
      console.log(
        `Object number ${currentObjectNumber} is already valid and available.`
      );
      return true;
    }

    // Find the next available number
    let nextNumber = minNumber;
    while (usedNumbers.has(nextNumber) && nextNumber <= maxNumber) {
      nextNumber++;
    }

    // Check if we found an available number
    if (nextNumber > maxNumber) {
      vscode.window.showInformationMessage(
        `No available object numbers found in range ${minNumber}-${maxNumber}`
      );
    }

    // Define the regex to find the object type and number in the content
    const objectTypeRegex = new RegExp(
      `\\b(${objectType})\\b\\s+(\\d+)\\s+["']([^"']+)["']`,
      "i"
    );

    // Replace the object number in the file content
    const updatedContent = content.replace(
      objectTypeRegex,
      `$1 ${nextNumber} "$3"`
    );

    // Write the updated content back to the file
    fs.writeFileSync(fileInfo.path, updatedContent, "utf8");

    console.log(
      `Updated object number for ${objectType} from ${currentObjectNumber} to ${nextNumber}`
    );
    return true;
  } catch (error) {
    console.error("Error in assignAvailableObjectNumber:", error);
    return false;
  }
}

function registerfileEvents(context) {
  const disposable = fileEvents((fileInfo) => {
    createIndexFolder();
    updateFileIndex(fileInfo);
    postCorrections(fileInfo);
  });

  if (context && context.subscriptions) {
    context.subscriptions.push(disposable);
  }
}

module.exports = {
  registerfileEvents,
};
