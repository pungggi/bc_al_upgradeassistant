const path = require("path");

/**
 * Creates a regex pattern from documentation IDs
 * @param {Array<{id: string}>} docIds - Documentation ID objects
 * @returns {{idMap: Object, regex: RegExp|null}} Map of IDs and regex pattern
 */
function createDocumentationRegex(docIds) {
  if (!docIds || docIds.length === 0) {
    return { idMap: {}, regex: null };
  }

  // Create a map of documentation IDs for quick lookup
  const idMap = {};
  docIds.forEach((doc) => {
    idMap[doc.id] = doc;
  });

  // Create a regex pattern from all the documentation IDs
  const idPattern = Object.keys(idMap).join("|");
  if (!idPattern) {
    return { idMap, regex: null };
  }

  // Return regex that matches the ID even if it's part of a larger word/identifier
  // and captures the task ID (text after the doc ID until the first space)
  return {
    idMap,
    regex: new RegExp(`(${idPattern})(/[^\\s]+)?`, "g"),
  };
}

/**
 * Finds all documentation references in text content
 * @param {string} content - The content to search in
 * @param {RegExp} regex - Regex pattern for matching documentation IDs
 * @param {Object} idMap - Map of documentation IDs to their info
 * @param {string} [filePath] - Optional file path for context
 * @returns {Array<{id: string, taskId: string, lineNumber: number, description: string, url: string, context: string}>} Found references
 */
function findDocumentationReferences(content, regex, idMap = "") {
  if (!content || !regex || !idMap) {
    return [];
  }

  const docRefs = [];
  const lines = content.split("\n");

  // Scan each line for references
  lines.forEach((line, index) => {
    // Reset regex for each line
    regex.lastIndex = 0;
    let match;

    while ((match = regex.exec(line)) !== null) {
      const id = match[1]; // This will be the matched ID
      const taskId = match[2] || ""; // This will be the task ID if available
      const docInfo = idMap[id];

      if (docInfo) {
        // Extract the context
        const context = line.trim();

        docRefs.push({
          id,
          taskId,
          lineNumber: index + 1,
          description: docInfo.description || "",
          url: docInfo.url || "",
          fullMatch: match[0],
          context:
            context.length > 500 ? context.substring(0, 499) + "..." : context,
        });
      }
    }
  });

  // Sort by line number
  return docRefs.sort((a, b) => a.lineNumber - b.lineNumber);
}

/**
 * Filters text content to only include lines with matching documentation IDs
 * @param {string} content - The content to filter
 * @param {RegExp} regex - Regex pattern for matching documentation IDs
 * @returns {string} Filtered content
 */
function filterContentByDocumentationIds(content, regex) {
  if (!content || !regex) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const filteredLines = [];

  // Only include lines that contain at least one configured documentation ID
  for (const line of lines) {
    // Reset regex for each line
    regex.lastIndex = 0;

    if (regex.test(line)) {
      filteredLines.push(line);
    }
  }

  return filteredLines.join("\n");
}

/**
 * Get storage file path for documentation reference data
 * @param {Function} findIndexFolder - Function to find the index folder
 * @returns {string} Path to storage file
 */
function getDocumentationStorageFile(findIndexFolder) {
  const indexFolder = findIndexFolder ? findIndexFolder() : null;
  if (!indexFolder) {
    // Fallback to workspace storage
    const vscode = require("vscode");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      return "";
    }
    return path.join(workspaceFolder, ".bc-al-docrefs.json");
  }

  return path.join(indexFolder, "documentation-references.json");
}

/**
 * Normalize a file path for storage as a key
 * @param {string} filePath - File path
 * @returns {string} Normalized path
 */
function normalizePathForStorage(filePath) {
  // Use forward slashes for consistency across platforms
  return filePath.replace(/\\/g, "/");
}

/**
 * Find all procedures in the content
 * @param {string} content - The content to search in
 * @returns {Array<{name: string, isLocal: boolean, lineNumber: number, context: string}>} Found procedures
 */
function findProcedures(content) {
  if (!content) return [];

  const procedures = [];
  const lines = content.split("\n");
  const procRegex = /^\s*(LOCAL\s+)?PROCEDURE\s+(\w+)@\d+\s*\(/i;
  let currentProc = null;

  lines.forEach((line, index) => {
    const trimmedLine = line.trim().toLowerCase();
    const match = line.match(procRegex);

    if (match) {
      if (currentProc) {
        currentProc.endLine = index;
      }
      currentProc = {
        name: match[2],
        isLocal: !!match[1],
        lineNumber: index + 1,
        startLine: index + 1,
        context: line.trim(),
      };
      procedures.push(currentProc);
    } else if (trimmedLine === "end;" && currentProc) {
      currentProc.endLine = index + 1;
      currentProc = null;
    }
  });

  // Handle the last procedure if it hasn't been closed
  if (currentProc && !currentProc.endLine) {
    currentProc.endLine = lines.length;
  }

  return procedures;
}

/**
 * Find all triggers in the content
 * @param {string} content - The content to search in
 * @returns {Array<{name: string, lineNumber: number, context: string}>} Found triggers
 */
function findTriggers(content) {
  if (!content) return [];

  const triggers = [];
  const lines = content.split("\n");
  let inProperties = false;
  let currentTrigger = null;
  const triggerRegex = /^\s*(On\w+)\s*=/i;

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    if (trimmedLine === "PROPERTIES") {
      inProperties = true;
    } else if (inProperties) {
      if (trimmedLine === "ActionList=ACTIONS" || trimmedLine === "}") {
        if (currentTrigger) {
          currentTrigger.endLine = index;
          currentTrigger = null;
        }
        inProperties = false;
      } else {
        const match = trimmedLine.match(triggerRegex);
        if (match) {
          if (currentTrigger) {
            currentTrigger.endLine = index;
          }
          currentTrigger = {
            name: match[1],
            lineNumber: index + 1,
            startLine: index + 1,
            context: line.trim(),
          };
          triggers.push(currentTrigger);
        } else if (currentTrigger && trimmedLine === "BEGIN") {
          // The actual trigger code starts after BEGIN
          currentTrigger.startLine = index + 1;
        } else if (currentTrigger && trimmedLine === "END") {
          currentTrigger.endLine = index + 1;
          currentTrigger = null;
        }
      }
    }
  });

  // Handle unclosed trigger
  if (currentTrigger && !currentTrigger.endLine) {
    currentTrigger.endLine = lines.length;
  }

  return triggers;
}

/**
 * Find all actions in the content
 * @param {string} content - The content to search in
 * @returns {Array<{name: string, lineNumber: number, context: string}>} Found actions
 */
function findActions(content) {
  if (!content) return [];

  const actions = [];
  const lines = content.split("\n");
  const actionRegex = /^\s*Name\s*=\s*(\w+)\s*;/i;
  let currentAction = null;

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    const match = line.match(actionRegex);

    if (match) {
      if (currentAction) {
        currentAction.endLine = index;
      }
      currentAction = {
        name: match[1],
        lineNumber: index + 1,
        startLine: index + 1,
        context: line.trim(),
      };
      actions.push(currentAction);
    } else if (currentAction && trimmedLine === "{") {
      // Action code block starts
      currentAction.startLine = index + 1;
    } else if (currentAction && trimmedLine === "}") {
      currentAction.endLine = index + 1;
      currentAction = null;
    }
  });

  // Handle unclosed action
  if (currentAction && !currentAction.endLine) {
    currentAction.endLine = lines.length;
  }

  return actions;
}

/**
 * Find all fields in the content
 * @param {string} content - The content to search in
 * @returns {Array<{id: string, name: string, lineNumber: number, context: string}>} Found fields
 */
function findFields(content) {
  if (!content) return [];

  const fields = [];
  const lines = content.split("\n");
  const fieldRegex = /^\s*{\s*(\d+)\s*;\s*;([^;]+);/;
  let currentField = null;

  lines.forEach((line, index) => {
    const match = line.match(fieldRegex);

    if (match) {
      if (currentField) {
        currentField.endLine = index;
      }
      currentField = {
        id: match[1],
        name: match[2].trim(),
        lineNumber: index + 1,
        startLine: index + 1,
        endLine: index + 1, // Single line for basic fields
        context: line.trim(),
      };
      fields.push(currentField);
    } else if (currentField && line.trim().startsWith("{")) {
      // Field definitions can span multiple lines
      currentField.endLine = index + 1;
    }
  });

  return fields;
}

module.exports = {
  createDocumentationRegex,
  findDocumentationReferences,
  filterContentByDocumentationIds,
  getDocumentationStorageFile,
  normalizePathForStorage,
  findProcedures,
  findTriggers,
  findActions,
  findFields,
};
