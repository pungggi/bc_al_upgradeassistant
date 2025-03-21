const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const configManager = require("./configManager");
const { checkExistingBasePath } = require("./basePathHelper");

/**
 * Extract individual C/AL objects from a text file containing multiple objects
 * @param {string} sourceFilePath - Path to the source file containing multiple C/AL objects
 * @param {string} outputFolderPath - Path to the folder where extracted objects will be saved
 * @param {boolean} organizeByType - Whether to organize objects in subfolders by type
 * @returns {Promise<{files: Array<string>, summaryFile: string}>} - List of extracted file paths and summary file path
 */
async function extractObjects(
  sourceFilePath,
  outputFolderPath = "",
  organizeByType = true
) {
  // If no output folder provided, create a subfolder in the same directory as source file
  if (!outputFolderPath) {
    outputFolderPath = path.join(
      path.dirname(sourceFilePath),
      "extracted_objects"
    );
  }

  // Create output folder if it doesn't exist
  if (!fs.existsSync(outputFolderPath)) {
    fs.mkdirSync(outputFolderPath, { recursive: true });
  }

  const extractedFiles = [];
  let currentObject = "";
  let currentObjectType = "";
  let currentObjectId = "";
  let currentObjectName = "";
  let isInsideObject = false;

  // Keep track of object counts by type
  const objectCountsByType = {};
  // Keep track of upgraded object folders by type
  const upgradedObjectFoldersByType = {};

  try {
    const content = fs.readFileSync(sourceFilePath, "utf8");
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      // Check if line starts a new object - either C/AL style or AL extension style
      const isCalObject = line.trim().startsWith("OBJECT ");
      const isAlExtensionObject =
        /^\s*(tableextension|pageextension|reportextension|codeunitextension|enumextension)\s+/i.test(
          line.trim()
        );

      if (isCalObject || isAlExtensionObject) {
        // Save previous object if exists
        if (isInsideObject && currentObject) {
          const fileName = getFileName(
            currentObjectType,
            currentObjectId,
            currentObjectName
          );

          let targetFolder = outputFolderPath;

          // Create type subfolder if organizing by type
          if (organizeByType && currentObjectType) {
            targetFolder = path.join(outputFolderPath, currentObjectType + "s");
            if (!fs.existsSync(targetFolder)) {
              fs.mkdirSync(targetFolder, { recursive: true });
            }

            // Store location for this object type as RELATIVE path to basePath
            upgradedObjectFoldersByType[currentObjectType] =
              currentObjectType + "s";

            // Count objects by type
            if (!objectCountsByType[currentObjectType]) {
              objectCountsByType[currentObjectType] = 1;
            } else {
              objectCountsByType[currentObjectType]++;
            }
          }

          const filePath = path.join(targetFolder, fileName);
          fs.writeFileSync(filePath, currentObject);
          extractedFiles.push(filePath);
        }

        // Reset for new object
        currentObject = "";
        isInsideObject = true;

        // Extract object type and ID based on object format
        if (isCalObject) {
          // Old C/AL format: OBJECT Type ID Name
          const objectMatch = line.match(/OBJECT\s+(\w+)\s+(\d+)\s+(.*)/i);
          if (objectMatch) {
            currentObjectType = objectMatch[1];
            currentObjectId = objectMatch[2];
            currentObjectName = objectMatch[3];
          }
        } else if (isAlExtensionObject) {
          // AL extension format: type ID "Name" extends BaseObject
          const extensionMatch = line.match(
            /(\w+extension)\s+(\d+)\s+["']([^"']+)["']/i
          );
          if (extensionMatch) {
            currentObjectType = extensionMatch[1]; // e.g., "tableextension"
            currentObjectId = extensionMatch[2];
            currentObjectName = extensionMatch[3];
          }
        }
      }

      // Add line to current object
      if (isInsideObject) {
        currentObject += line + "\n";
      }
    }

    // Save the last object if exists
    if (isInsideObject && currentObject) {
      const fileName = getFileName(
        currentObjectType,
        currentObjectId,
        currentObjectName
      );

      let targetFolder = outputFolderPath;

      // Create type subfolder if organizing by type
      if (organizeByType && currentObjectType) {
        targetFolder = path.join(outputFolderPath, currentObjectType + "s");
        if (!fs.existsSync(targetFolder)) {
          fs.mkdirSync(targetFolder, { recursive: true });
        }

        // Store location for this object type as RELATIVE path to basePath
        upgradedObjectFoldersByType[currentObjectType] =
          currentObjectType + "s";

        // Count objects by type
        if (!objectCountsByType[currentObjectType]) {
          objectCountsByType[currentObjectType] = 1;
        } else {
          objectCountsByType[currentObjectType]++;
        }
      }

      const filePath = path.join(targetFolder, fileName);
      fs.writeFileSync(filePath, currentObject);
      extractedFiles.push(filePath);
    }

    // Create a summary file with statistics
    const summaryFilePath = path.join(
      outputFolderPath,
      "_extraction_summary.txt"
    );
    let summaryContent = `Extraction Summary\n`;
    summaryContent += `----------------\n`;
    summaryContent += `Source file: ${path.basename(sourceFilePath)}\n`;
    summaryContent += `Extraction date: ${new Date().toLocaleString()}\n\n`;
    summaryContent += `Total objects extracted: ${extractedFiles.length}\n\n`;

    // Add base path information
    summaryContent += `Base extraction path: ${outputFolderPath}\n\n`;
    summaryContent += `Objects by type:\n`;

    for (const type in objectCountsByType) {
      summaryContent += `- ${type}s: ${objectCountsByType[type]}\n`;
    }

    fs.writeFileSync(summaryFilePath, summaryContent);

    // Save the upgraded object folders to configuration
    if (Object.keys(upgradedObjectFoldersByType).length > 0) {
      // Store base path as absolute path in upgradedObjectFoldersByType
      upgradedObjectFoldersByType["basePath"] = outputFolderPath;

      // Check if we already have a configuration
      const { proceed, overwrite } = await checkExistingBasePath(configManager);

      if (!proceed) {
        return {
          success: false,
          message: "Operation cancelled by user",
        };
      }

      if (overwrite) {
        // Only update the configuration if user chose to overwrite
        await configManager.setConfigValue(
          "upgradedObjectFolders",
          upgradedObjectFoldersByType
        );
      }
    }

    return {
      files: extractedFiles,
      summaryFile: summaryFilePath,
      objectLocations: upgradedObjectFoldersByType,
    };
  } catch (error) {
    console.error("Error extracting objects:", error);
    throw error;
  }
}

/**
 * Generate a filename for the extracted object
 * @param {string} objectType - Type of the object (Table, Page, Report, etc.)
 * @param {string} objectId - Object ID
 * @param {string} objectName - Object name
 * @returns {string} - Generated filename
 */
function getFileName(objectType, objectId, objectName) {
  if (!objectType || !objectId || !objectName) {
    return `Unknown_Object_${Date.now()}.txt`;
  }

  // Clean object name for safe filename - replace spaces with underscores
  const cleanName = objectName
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .trim();
  return `${objectType}${objectId}_${cleanName}.txt`;
}

/**
 * Get the locations of upgraded objects by type
 * @returns {Object|null} Object with location information or null if not available
 */
function getUpgradedObjectFoldersByType() {
  return configManager.getConfigValue("upgradedObjectFolders", null);
}

/**
 * Get the location for a specific object type
 * @param {string} objectType - The object type to get location for (e.g., "Table", "Page")
 * @returns {string|null} The path where objects of this type are stored, or null if not found
 */
function getLocationForObjectType(objectType) {
  const locations = getUpgradedObjectFoldersByType();
  if (!locations) return null;

  const basePath = locations["basePath"];
  if (!basePath) return null;

  // Early return if exact match found
  if (locations[objectType]) {
    return path.join(basePath, locations[objectType]);
  }

  // Try to find a matching pattern (e.g. "tableextension" -> "table")
  for (const locationType in locations) {
    if (
      locationType !== "basePath" &&
      (objectType.includes(locationType) || locationType.includes(objectType))
    ) {
      return path.join(basePath, locations[locationType]);
    }
  }

  // If no matching folder found, return basePath
  return basePath;
}

/**
 * Extract objects from a selected file path through a dialog
 */
async function extractObjectsFromPath() {
  try {
    // Check for existing configuration first
    const { proceed, overwrite } = await checkExistingBasePath(configManager);

    if (!proceed) {
      return;
    }

    // Ask user to select a C/AL file
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Select C/AL file to extract objects from",
      filters: {
        "CAL Files": ["txt"],
        "All Files": ["*"],
      },
    });

    if (!fileUris || fileUris.length === 0) {
      return; // User canceled
    }

    const sourceFilePath = fileUris[0].fsPath;

    // Ask user to select output folder
    const outputFolderUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select output folder",
    });

    let outputFolderPath = "";
    if (outputFolderUri && outputFolderUri.length > 0) {
      outputFolderPath = outputFolderUri[0].fsPath;
    } else {
      // Use default if user cancels
      outputFolderPath = path.join(
        path.dirname(sourceFilePath),
        "extracted_objects"
      );
    }

    // Always organize by type
    const shouldOrganize = true;

    // Show progress while splitting
    const extraction = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Splitting C/AL objects",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0, message: "Reading source file..." });

        // Get file content and estimate object count for better progress reporting
        const content = fs.readFileSync(sourceFilePath, "utf8");
        const lines = content.split(/\r?\n/);

        // Rough estimation of object count (each OBJECT keyword likely starts a new object)
        const estimatedObjectCount = lines.filter(
          (line) =>
            line.trim().startsWith("OBJECT ") ||
            /^\s*(table|page|report|codeunit)\s+/i.test(line.trim())
        ).length;

        progress.report({
          increment: 5,
          message: `Found approximately ${estimatedObjectCount} objects to extract...`,
        });

        // Call the extraction with progress updates
        const result = await extractObjectsWithProgress(
          sourceFilePath,
          outputFolderPath,
          shouldOrganize,
          progress,
          estimatedObjectCount
        );

        // Check if we received a valid result
        if (!result || result.success === false) {
          return (
            result || {
              success: false,
              files: [],
              summaryFile: null,
              objectLocations: {},
            }
          );
        }

        progress.report({
          increment: 100,
          message: `Completed! Extracted ${result.files.length} objects`,
        });

        return result;
      }
    );

    // Exit early if extraction was cancelled or failed
    if (!extraction || extraction.success === false) {
      if (extraction && extraction.message) {
        vscode.window.showInformationMessage(extraction.message);
      }
      return;
    }

    // Save the extracted folder locations to configuration
    if (
      extraction.objectLocations &&
      Object.keys(extraction.objectLocations).length > 0 &&
      overwrite
    ) {
      // Only save if overwrite was chosen
      await configManager.setConfigValue(
        "upgradedObjectFolders",
        extraction.objectLocations
      );
      vscode.window.showInformationMessage(
        "Object folder locations have been saved to your settings."
      );
    }

    // Only continue if we have a valid summary file
    if (!extraction.summaryFile || !extraction.files) {
      vscode.window.showInformationMessage(
        "The extraction was completed but produced no results."
      );
      return;
    }

    // Show success message with the output folder path and a link to view the summary
    const summaryUri = vscode.Uri.file(extraction.summaryFile);
    const fileCount = extraction.files.length || 0;

    vscode.window
      .showInformationMessage(
        `Successfully extracted ${fileCount} objects to "${outputFolderPath}"`,
        {
          modal: false,
          detail: "Click 'View Summary' to see extraction details",
        },
        { title: "View Summary" }
      )
      .then((selection) => {
        if (selection && selection.title === "View Summary") {
          vscode.workspace
            .openTextDocument(summaryUri)
            .then((doc) => vscode.window.showTextDocument(doc));
        }
      });
  } catch (error) {
    console.error("Error extracting objects:", error);
    vscode.window.showErrorMessage(
      `Error extracting objects: ${error.message}`
    );
  }
}

/**
 * Extract objects with progress reporting
 * @param {string} sourceFilePath - Path to the source file
 * @param {string} outputFolderPath - Path to the output folder
 * @param {boolean} organizeByType - Whether to organize objects by type
 * @param {vscode.Progress} progress - VS Code progress object
 * @param {number} estimatedCount - Estimated number of objects
 * @returns {Promise<{files: Array<string>, summaryFile: string, objectLocations: Object, success: boolean}>}
 */
async function extractObjectsWithProgress(
  sourceFilePath,
  outputFolderPath,
  organizeByType,
  progress,
  estimatedCount
) {
  // Validate input parameters to prevent undefined errors
  if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
    return {
      success: false,
      message: "Source file does not exist or is invalid",
      files: [],
      summaryFile: null,
      objectLocations: {},
    };
  }

  // If no output folder provided, create a subfolder in the same directory as source file
  if (!outputFolderPath) {
    outputFolderPath = path.join(
      path.dirname(sourceFilePath),
      "extracted_objects"
    );
  }

  // Create output folder if it doesn't exist
  if (!fs.existsSync(outputFolderPath)) {
    try {
      fs.mkdirSync(outputFolderPath, { recursive: true });
    } catch (error) {
      return {
        success: false,
        message: `Failed to create output directory: ${error.message}`,
        files: [],
        summaryFile: null,
        objectLocations: {},
      };
    }
  }

  const extractedFiles = [];
  let currentObject = "";
  let currentObjectType = "";
  let currentObjectId = "";
  let currentObjectName = "";
  let isInsideObject = false;
  let extractedCount = 0;

  // Keep track of object counts by type
  const objectCountsByType = {};
  // Keep track of upgraded object folders by type
  const upgradedObjectFoldersByType = {};

  try {
    const content = fs.readFileSync(sourceFilePath, "utf8");
    const lines = content.split(/\r?\n/);

    // Calculate file size in KB for display
    const fileSizeKB = (content.length / 1024).toFixed(2);

    progress.report({
      increment: 10,
      message: `Analyzing ${fileSizeKB} KB file (${lines.length} lines)...`,
    });

    let lastProgressUpdate = Date.now();
    let processedLines = 0;
    const totalLines = lines.length;

    for (const line of lines) {
      processedLines++;

      // Periodically update the line processing progress
      const now = Date.now();
      if (now - lastProgressUpdate > 300) {
        const lineProgressPercent = Math.round(
          (processedLines / totalLines) * 100
        );
        progress.report({
          increment: 0,
          message: `Analyzing file: ${lineProgressPercent}% (${processedLines}/${totalLines} lines, ${fileSizeKB} KB)`,
        });
        lastProgressUpdate = now;
      }

      // Check if line starts a new object - either C/AL style or AL extension style
      const isCalObject = line.trim().startsWith("OBJECT ");
      const isAlExtensionObject =
        /^\s*(tableextension|pageextension|reportextension|codeunitextension|enumextension)\s+/i.test(
          line.trim()
        );

      if (isCalObject || isAlExtensionObject) {
        // Save previous object if exists
        if (isInsideObject && currentObject) {
          const fileName = getFileName(
            currentObjectType,
            currentObjectId,
            currentObjectName
          );

          let targetFolder = outputFolderPath;

          // Create type subfolder if organizing by type
          if (organizeByType && currentObjectType) {
            targetFolder = path.join(outputFolderPath, currentObjectType + "s");
            if (!fs.existsSync(targetFolder)) {
              fs.mkdirSync(targetFolder, { recursive: true });
            }

            // Store location for this object type as RELATIVE path to basePath
            upgradedObjectFoldersByType[currentObjectType] =
              currentObjectType + "s";

            // Count objects by type
            if (!objectCountsByType[currentObjectType]) {
              objectCountsByType[currentObjectType] = 1;
            } else {
              objectCountsByType[currentObjectType]++;
            }
          }

          const filePath = path.join(targetFolder, fileName);
          fs.writeFileSync(filePath, currentObject);
          extractedFiles.push(filePath);

          // Increment extracted count
          extractedCount++;

          // Update progress periodically (not on every object to avoid UI freezing)
          const now = Date.now();
          if (now - lastProgressUpdate > 300) {
            const objectSizeKB = (currentObject.length / 1024).toFixed(2);

            // Calculate approximate remaining objects
            const remainingObjects =
              estimatedCount > 0 ? estimatedCount - extractedCount : "unknown";

            progress.report({
              increment: 0,
              message: `Extracted ${extractedCount} objects (${objectSizeKB} KB last, ${remainingObjects} remaining)...`,
            });
            lastProgressUpdate = now;
          }
        }

        // Reset for new object
        currentObject = "";
        isInsideObject = true;

        // Extract object type and ID based on object format
        if (isCalObject) {
          // Old C/AL format: OBJECT Type ID Name
          const objectMatch = line.match(/OBJECT\s+(\w+)\s+(\d+)\s+(.*)/i);
          if (objectMatch) {
            currentObjectType = objectMatch[1];
            currentObjectId = objectMatch[2];
            currentObjectName = objectMatch[3];
          }
        } else if (isAlExtensionObject) {
          // AL extension format: type ID "Name" extends BaseObject
          const extensionMatch = line.match(
            /(\w+extension)\s+(\d+)\s+["']([^"']+)["']/i
          );
          if (extensionMatch) {
            currentObjectType = extensionMatch[1]; // e.g., "tableextension"
            currentObjectId = extensionMatch[2];
            currentObjectName = extensionMatch[3];
          }
        }
      }

      // Add line to current object
      if (isInsideObject) {
        currentObject += line + "\n";
      }
    }

    // Save the last object if exists
    if (isInsideObject && currentObject) {
      const fileName = getFileName(
        currentObjectType,
        currentObjectId,
        currentObjectName
      );

      let targetFolder = outputFolderPath;

      // Create type subfolder if organizing by type
      if (organizeByType && currentObjectType) {
        targetFolder = path.join(outputFolderPath, currentObjectType + "s");
        if (!fs.existsSync(targetFolder)) {
          fs.mkdirSync(targetFolder, { recursive: true });
        }

        // Store location for this object type as RELATIVE path to basePath
        upgradedObjectFoldersByType[currentObjectType] =
          currentObjectType + "s";

        // Count objects by type
        if (!objectCountsByType[currentObjectType]) {
          objectCountsByType[currentObjectType] = 1;
        } else {
          objectCountsByType[currentObjectType]++;
        }
      }

      const filePath = path.join(targetFolder, fileName);
      fs.writeFileSync(filePath, currentObject);
      extractedFiles.push(filePath);
      extractedCount++;
    }

    progress.report({
      increment: 85,
      message: `Creating extraction summary for ${extractedCount} objects (${fileSizeKB} KB processed)...`,
    });

    // Create a summary file with statistics
    const summaryFilePath = path.join(
      outputFolderPath,
      "_extraction_summary.txt"
    );
    let summaryContent = `Extraction Summary\n`;
    summaryContent += `----------------\n`;
    summaryContent += `Source file: ${path.basename(sourceFilePath)}\n`;
    summaryContent += `Extraction date: ${new Date().toLocaleString()}\n\n`;
    summaryContent += `Total objects extracted: ${extractedFiles.length}\n\n`;

    // Add base path information
    summaryContent += `Base extraction path: ${outputFolderPath}\n\n`;

    summaryContent += `Objects by type:\n`;

    for (const type in objectCountsByType) {
      summaryContent += `- ${type}s: ${objectCountsByType[type]}\n`;
    }

    fs.writeFileSync(summaryFilePath, summaryContent);

    // Save the upgraded object folders to configuration
    if (Object.keys(upgradedObjectFoldersByType).length > 0) {
      // Store base path as absolute path in upgradedObjectFoldersByType
      upgradedObjectFoldersByType["basePath"] = outputFolderPath;
    }

    progress.report({
      increment: 100,
      message: `Complete! Extracted ${extractedFiles.length} objects from ${fileSizeKB} KB file`,
    });

    return {
      success: true,
      files: extractedFiles,
      summaryFile: summaryFilePath,
      objectLocations: upgradedObjectFoldersByType,
    };
  } catch (error) {
    console.error("Error extracting objects:", error);
    return {
      success: false,
      message: `Error during extraction: ${error.message}`,
      files: extractedFiles,
      summaryFile: null,
      objectLocations: {},
      overwrite: false,
    };
  }
}

module.exports = {
  extractObjects,
  extractObjectsFromPath,
  getUpgradedObjectFoldersByType,
  getLocationForObjectType,
};
