const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const configManager = require("./configManager");

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
      // Check if line starts a new object
      if (line.trim().startsWith("OBJECT ")) {
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

            // Store location for this object type
            upgradedObjectFoldersByType[currentObjectType] = targetFolder;

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

        // Extract object type and ID
        const objectMatch = line.match(/OBJECT\s+(\w+)\s+(\d+)\s+(.*)/i);
        if (objectMatch) {
          currentObjectType = objectMatch[1];
          currentObjectId = objectMatch[2];
          currentObjectName = objectMatch[3];
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

        // Store location for this object type
        upgradedObjectFoldersByType[currentObjectType] = targetFolder;

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
      await configManager.setConfigValue(
        "upgradedObjectFolders",
        upgradedObjectFoldersByType
      );
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
  if (
    locations &&
    locations.typeLocations &&
    locations.typeLocations[objectType]
  ) {
    return locations.typeLocations[objectType];
  }
  return null;
}

/**
 * Show a UI dialog to extract objects from the current active file
 */
async function extractObjectsWithDialog() {
  try {
    // Get the current active text editor
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(
        "No active file. Please open a C/AL text file first."
      );
      return;
    }

    const sourceFilePath = editor.document.uri.fsPath;

    // Check if file is saved
    if (editor.document.isDirty) {
      const save = await vscode.window.showWarningMessage(
        "The file has unsaved changes. Do you want to save it before extracting objects?",
        "Save",
        "Extract without saving",
        "Cancel"
      );

      if (save === "Save") {
        await editor.document.save();
      } else if (save === "Cancel" || save === undefined) {
        return;
      }
    }

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

    // Always organize by type (removed user prompt)
    const shouldOrganize = true;

    // Show progress while splitting
    const extraction = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Splitting C/AL objects",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0, message: "Starting extraction..." });
        const result = await extractObjects(
          sourceFilePath,
          outputFolderPath,
          shouldOrganize
        );
        progress.report({
          increment: 100,
          message: `Splitted ${result.files.length} objects`,
        });
        return result;
      }
    );

    // Save the extracted folder locations to configuration
    if (
      extraction.objectLocations &&
      Object.keys(extraction.objectLocations).length > 0
    ) {
      await configManager.setConfigValue(
        "upgradedObjectFolders",
        extraction.objectLocations
      );
      vscode.window.showInformationMessage(
        "Object folder locations have been saved to your settings."
      );
    }

    // Show success message with the output folder path and a link to view the summary
    const summaryUri = vscode.Uri.file(extraction.summaryFile);

    vscode.window
      .showInformationMessage(
        `Successfully splitted ${extraction.files.length} objects to "${outputFolderPath}"`,
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
    vscode.window.showErrorMessage(`Error splitting objects: ${error.message}`);
  }
}

module.exports = {
  extractObjects,
  extractObjectsWithDialog,
  getUpgradedObjectFoldersByType,
  getLocationForObjectType,
};
