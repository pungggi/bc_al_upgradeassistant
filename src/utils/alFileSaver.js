const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const configManager = require("./configManager");

/**
 * Extracts AL code blocks from Markdown text
 * @param {string} markdownText - The markdown text containing AL code blocks
 * @returns {Array<string>} - Array of extracted AL code blocks
 */
function extractAlCodeFromMarkdown(markdownText) {
  const alCodeBlocks = [];

  // Pattern to match ```al ... ``` code blocks (case insensitive)
  const alBlockRegex = /```(?:al|AL)\s+([\s\S]*?)```/g;

  let match;
  while ((match = alBlockRegex.exec(markdownText)) !== null) {
    if (match[1].trim()) {
      alCodeBlocks.push(match[1].trim());
    }
  }

  return alCodeBlocks;
}

/**
 * Attempts to identify the AL object type from code
 * @param {string} alCode - AL code to analyze
 * @returns {{type: string, id: string, name: string}|null} - Object info or null if not detected
 */
function identifyAlObjectInfo(alCode) {
  // Match common AL object patterns
  const patterns = [
    // tableextension, pageextension, etc.
    /\b(tableextension|pageextension|reportextension|codeunitextension)\s+(\d+)\s+["']([^"']+)["']/i,
    // table, page, report, codeunit, etc.
    /\b(table|page|report|codeunit|query|xmlport|enum|profile|interface)\s+(\d+)\s+["']([^"']+)["']/i,
    // permissionset
    /\b(permissionset)\s+(\w+)\s+/i,
  ];

  for (const pattern of patterns) {
    const match = alCode.match(pattern);
    if (match) {
      return {
        type: match[1],
        id: match[2],
        name: match[3] || match[2], // For permissionsets with no numeric ID
      };
    }
  }

  return null;
}

/**
 * Gets an appropriate file name for the AL code
 * @param {string} alCode - The AL code
 * @param {string} defaultName - Default name to use if object info can't be detected
 * @returns {{fileName: string, objectInfo: object|null}} - File name and object info
 */
function getAlFileName(alCode, defaultName = "GeneratedObject") {
  const objectInfo = identifyAlObjectInfo(alCode);

  if (objectInfo) {
    // Properly sanitize the object name to create a valid filename
    const sanitizedName = sanitizeFileName(objectInfo.name);
    return {
      fileName: `${objectInfo.type}${objectInfo.id}_${sanitizedName}.al`,
      objectInfo,
    };
  }

  // Default to timestamp if no object info detected
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    fileName: `${defaultName}_${timestamp}.al`,
    objectInfo: null,
  };
}

/**
 * Sanitizes a string to be used as a valid file name
 * @param {string} fileName - The file name to sanitize
 * @returns {string} - Sanitized file name
 */
function sanitizeFileName(fileName) {
  if (!fileName) return "Unnamed";

  // Replace invalid characters with underscores
  return fileName
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .trim();
}

/**
 * Save AL code to a file based on configuration settings
 * @param {string} alCode - The AL code to save
 * @returns {Promise<string|null>} - Path to the saved file or null if cancelled
 */
async function saveAlCodeToFile(alCode) {
  // Get file name based on AL object info
  const { fileName, objectInfo } = getAlFileName(alCode);

  let targetFolder = null;

  // Check if we have workingObjectFolders setting and try to use it
  if (objectInfo && objectInfo.type) {
    // Convert object type to lowercase for consistent lookup
    const objectType = objectInfo.type.toLowerCase();
    const workingObjectFolders = configManager.getConfigValue(
      "workingObjectFolders",
      {}
    );

    // First try exact match
    if (workingObjectFolders[objectType]) {
      targetFolder = workingObjectFolders[objectType];
    } else {
      // Try to find a matching pattern (e.g. "tableextension" -> "table")
      for (const locationType in workingObjectFolders) {
        if (
          objectType.includes(locationType) ||
          locationType.includes(objectType)
        ) {
          targetFolder = workingObjectFolders[locationType];
          break;
        }
      }
    }

    // If still no match but we have a default location, use it
    if (!targetFolder && workingObjectFolders["default"]) {
      targetFolder = workingObjectFolders["default"];
    }
  }

  // If no target folder yet, ask user to select one
  if (!targetFolder) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let defaultUri = undefined;

    // If we have a workspace folder, start from there
    if (workspaceFolders && workspaceFolders.length > 0) {
      defaultUri = workspaceFolders[0].uri;
    }

    const selectedFolder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Save AL code to folder",
      title: "Select folder to save AL code",
      defaultUri,
    });

    if (!selectedFolder || selectedFolder.length === 0) {
      return null; // User cancelled
    }

    targetFolder = selectedFolder[0].fsPath;

    // If object info was detected, offer to save the location for future use
    if (objectInfo && objectInfo.type) {
      const saveLocation = await vscode.window.showQuickPick(
        [
          {
            label: "Yes",
            description: "Remember this location for future use",
          },
          { label: "No", description: "Don't remember location" },
        ],
        {
          placeHolder: `Remember this location for ${objectInfo.type} objects?`,
          canPickMany: false,
        }
      );

      if (saveLocation && saveLocation.label === "Yes") {
        // Update the settings
        const currentLocations = configManager.getConfigValue(
          "workingObjectFolders",
          {}
        );
        const updatedLocations = {
          ...currentLocations,
          [objectInfo.type.toLowerCase()]: targetFolder,
        };
        await configManager.updateConfig(
          "workingObjectFolders",
          updatedLocations
        );

        vscode.window.showInformationMessage(
          `Location for ${objectInfo.type} objects saved to settings.`
        );
      }
    }
  }

  // Ensure target folder exists
  if (!fs.existsSync(targetFolder)) {
    try {
      fs.mkdirSync(targetFolder, { recursive: true });
    } catch (err) {
      throw new Error(
        `Failed to create directory "${targetFolder}": ${err.message}`
      );
    }
  }

  // Generate full file path
  const filePath = path.join(targetFolder, fileName);

  // Check if file already exists
  if (fs.existsSync(filePath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `File '${fileName}' already exists in the target folder.`,
      "Overwrite",
      "Save as New",
      "Cancel"
    );

    if (overwrite === "Cancel") {
      return null;
    } else if (overwrite === "Save as New") {
      // Append timestamp to file name
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const newFileName = fileName.replace(".al", `_${timestamp}.al`);
      const filePath = path.join(targetFolder, newFileName);

      // Write the file
      try {
        fs.writeFileSync(filePath, alCode, "utf8");
      } catch (err) {
        throw new Error(`Failed to write file "${filePath}": ${err.message}`);
      }
      return filePath;
    }
    // For 'Overwrite', continue with normal flow
  }

  // Write the file
  try {
    fs.writeFileSync(filePath, alCode, "utf8");
  } catch (err) {
    throw new Error(`Failed to write file "${filePath}": ${err.message}`);
  }

  return filePath;
}

module.exports = {
  extractAlCodeFromMarkdown,
  identifyAlObjectInfo,
  getAlFileName,
  saveAlCodeToFile,
};
