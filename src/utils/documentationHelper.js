const path = require("path");
const fs = require("fs");

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
  return {
    idMap,
    regex: new RegExp(`(${idPattern})`, "g"),
  };
}

/**
 * Finds all documentation references in text content
 * @param {string} content - The content to search in
 * @param {RegExp} regex - Regex pattern for matching documentation IDs
 * @param {Object} idMap - Map of documentation IDs to their info
 * @param {string} [filePath] - Optional file path for context
 * @returns {Array<{id: string, lineNumber: number, description: string, url: string, context: string}>} Found references
 */
function findDocumentationReferences(content, regex, idMap, filePath = "") {
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
      const docInfo = idMap[id];

      if (docInfo) {
        console.log(
          `Found documentation ID '${id}' on line ${index + 1}${
            filePath ? ` in ${path.basename(filePath)}` : ""
          }: "${line.trim()}"`
        );

        // Extract the context
        const context = line.trim();

        docRefs.push({
          id,
          lineNumber: index + 1,
          description: docInfo.description || "",
          url: docInfo.url || "",
          fullMatch: match[0],
          context:
            context.length > 80 ? context.substring(0, 77) + "..." : context,
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

module.exports = {
  createDocumentationRegex,
  findDocumentationReferences,
  filterContentByDocumentationIds,
  getDocumentationStorageFile,
  normalizePathForStorage,
};
