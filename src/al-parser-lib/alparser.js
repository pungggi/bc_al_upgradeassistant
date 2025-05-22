// AL Parser Library (alparser.js) - Simplified for this task

/**
 * Simulates parsing an AL object definition from text.
 * In a real scenario, this would involve a proper AL language parser.
 *
 * @param {string} documentText The AL document text.
 * @returns {{Type: string, Name: string, ID: string} | null}
 *          An object with Type, Name, and ID, or null if no object found.
 */
function getObjectDefinition(documentText) {
  if (!documentText || typeof documentText !== 'string') {
    return null;
  }

  // Simplified regex to find the first AL object definition line
  // Example: report 50100 "My Report"
  // Example: reportextension 50101 "My Report Extension" extends "My Report"
  const objectRegex = /^\s*(reportextension|report|pageextension|page|tableextension|table|codeunit|query|xmlport|enum|interface|controladdin|permissionset)\s+(\d+)\s+(("([^"]*)")|([a-zA-Z0-9_]+))/im;

  const match = documentText.match(objectRegex);

  if (match) {
    const objectType = match[1];
    const objectId = match[2];
    // Name can be quoted (match[4]) or unquoted (match[5])
    const objectName = match[4] !== undefined ? match[4] : match[5];

    // Normalize Type for consistency (e.g., 'report' -> 'Report')
    let normalizedType = objectType.charAt(0).toUpperCase() + objectType.slice(1).toLowerCase();
    if (normalizedType === 'Reportextension') normalizedType = 'ReportExtension';
    // Add other normalizations if needed for other object types

    return {
      Type: normalizedType,
      Name: objectName,
      ID: objectId,
    };
  }

  return null; // No object definition found
}

// Ensure module.exports is set up correctly
module.exports = {
  getObjectDefinition,
};
