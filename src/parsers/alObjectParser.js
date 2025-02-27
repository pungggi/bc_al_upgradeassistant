const path = require("path");

/**
 * Parse a regular AL object from file content
 * @param {string} fileContent The file content
 * @param {vscode.Uri} fileUri The file URI
 * @returns {object|null} Object information or null if not a regular object
 */
function parseRegularObject(fileContent, fileUri) {
  // Match regular object definitions (page, table, report, etc.)
  const objectMatch = fileContent.match(
    /\b(page|table|report|codeunit|enum|query|xmlport)\s+(\d+)\s+"([^"]+)"/i
  );

  if (!objectMatch) {
    return null;
  }

  const [, objectType, objectId, objectName] = objectMatch;

  // Return the object information
  return {
    type: objectType.toLowerCase(),
    id: objectId,
    name: objectName,
    uri: fileUri.toString(),
    path: fileUri.fsPath,
    fileName: path.basename(fileUri.fsPath),
  };
}

/**
 * Add additional details to an object's information
 * @param {object} objectInfo The object information to enrich
 * @param {string} text The document text
 */
function enrichObjectInfo(objectInfo, text) {
  // Add field information for tables
  if (objectInfo.type === "table") {
    const fields = [];

    // Use more robust regex for fields in a table
    const fieldRegex = /field\((\d+);\s*"([^"]+)"/g;
    let match;

    while ((match = fieldRegex.exec(text)) !== null) {
      fields.push({
        id: match[1],
        name: match[2],
      });
    }

    objectInfo.fields = fields;
  }

  // Add controls for pages
  if (objectInfo.type === "page") {
    // Count controls - more robust implementation
    const controlMatches = text.match(/field\(([^;]*);\s*([^)]*)\)/g);
    objectInfo.controlsCount = controlMatches ? controlMatches.length : 0;
  }
}

module.exports = {
  parseRegularObject,
  enrichObjectInfo,
};
