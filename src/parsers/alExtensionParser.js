const vscode = require("vscode");

/**
 * Parse an AL extension object from file content
 * @param {string} fileContent The file content to parse
 * @param {vscode.Uri} fileUri URI of the file being parsed
 * @returns {object|null} The parsed extension object information or null if not an extension
 */
function parseExtensionObject(fileContent, fileUri) {
  // Skip if not an extension
  if (!isExtensionObject(fileContent)) {
    return null;
  }

  // Type patterns for different extension types
  const extensionTypePatterns = [
    {
      type: "tableextension",
      pattern: /tableextension\s+(\d+)\s+["'](.+?)["']/i,
    },
    {
      type: "pageextension",
      pattern: /pageextension\s+(\d+)\s+["'](.+?)["']/i,
    },
    {
      type: "reportextension",
      pattern: /reportextension\s+(\d+)\s+["'](.+?)["']/i,
    },
    {
      type: "enumextension",
      pattern: /enumextension\s+(\d+)\s+["'](.+?)["']/i,
    },
  ];

  let extensionInfo = null;

  // Try to match with each extension type pattern
  for (const { type, pattern } of extensionTypePatterns) {
    const match = fileContent.match(pattern);
    if (match) {
      const extendsPattern = /extends\s+["'](.+?)["']/i;
      const extendsMatch = fileContent.match(extendsPattern);

      extensionInfo = {
        type: type,
        id: parseInt(match[1]),
        name: match[2],
        extendsName: extendsMatch ? extendsMatch[1] : null,
        uri: fileUri.toString(),
        path: fileUri.fsPath,
      };
      break;
    }
  }

  return extensionInfo;
}

/**
 * Check if the content represents an extension object
 * @param {string} fileContent Content to check
 * @returns {boolean} True if this is an extension object
 */
function isExtensionObject(fileContent) {
  // Check for keywords that indicate extension objects
  return /\b(tableextension|pageextension|reportextension|enumextension)\b.*\bextends\b/i.test(
    fileContent
  );
}

module.exports = {
  parseExtensionObject,
};
