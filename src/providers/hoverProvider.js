const vscode = require("vscode");
const {
  getCacheKey,
  getObjectInfo,
  isInitialized,
  isInitializing,
  initializeCache,
} = require("../cache/objectCache");

/**
 * Provide hover information for extension objects
 * @param {vscode.TextDocument} document The document
 * @param {vscode.Position} position The position
 * @param {vscode.CancellationToken} token The cancellation token
 * @returns {vscode.Hover | null} The hover information
 */
async function provideExtensionHover(document, position, token) {
  // Ensure the cache is initialized
  if (!isInitialized()) {
    if (!isInitializing()) {
      await initializeCache();
    } else {
      // If cache is currently initializing, show a message
      return new vscode.Hover(
        "Cache is being initialized. Please try again in a moment."
      );
    }
  }

  // Get the current line and surrounding lines to handle multi-line definitions
  const startLine = Math.max(0, position.line - 2);
  const endLine = Math.min(document.lineCount - 1, position.line + 2);
  let textRange = new vscode.Range(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, document.lineAt(endLine).text.length)
  );

  const surroundingText = document.getText(textRange);

  // Check if the surrounding text contains an "extends" clause
  const extensionMatch = surroundingText.match(
    /(\w+extension)\s+(\d+)\s+"([^"]+)"\s+extends\s+"([^"]+)"/s
  );

  if (!extensionMatch) {
    return null;
  }

  const [
    fullMatch,
    extensionType,
    extensionId,
    extensionName,
    extendedObjectName,
  ] = extensionMatch;

  // Calculate the position of the "extends" clause in the document
  const fullText = document.getText();
  const matchStartIndex = fullText.indexOf(fullMatch);
  if (matchStartIndex === -1) {
    return null;
  }

  const extendsIndex = fullMatch.indexOf(`extends "${extendedObjectName}"`);
  if (extendsIndex === -1) {
    return null;
  }

  const extendsStartPos = document.positionAt(matchStartIndex + extendsIndex);
  const extendsEndPos = document.positionAt(
    matchStartIndex + extendsIndex + `extends "${extendedObjectName}"`.length
  );

  // Check if the cursor is on or near the extends clause
  const hoverRange = new vscode.Range(extendsStartPos, extendsEndPos);
  if (
    !hoverRange.contains(position) &&
    !new vscode.Range(
      hoverRange.end,
      hoverRange.end.translate(0, 10) // Allow some space after the extends
    ).contains(position)
  ) {
    return null;
  }

  // Determine the base object type from the extension type
  const baseObjectType = extensionType.toLowerCase().replace("extension", "");

  // Get information about the extended object from the cache
  const baseObjectInfo = getObjectInfo(baseObjectType, extendedObjectName);
  if (!baseObjectInfo) {
    return new vscode.Hover(
      `No cached information available for "${extendedObjectName}" (${baseObjectType})`,
      hoverRange
    );
  }

  return createHoverContent(baseObjectInfo, extensionName, hoverRange);
}

/**
 * Create hover content for an extended object
 * @param {object} baseObjectInfo Information about the base object
 * @param {string} currentExtensionName Name of the current extension
 * @param {vscode.Range} hoverRange Range where the hover should appear
 * @returns {vscode.Hover} Hover with formatted content
 */
function createHoverContent(baseObjectInfo, currentExtensionName, hoverRange) {
  // Format the hover markdown
  const hoverMarkdown = new vscode.MarkdownString();
  hoverMarkdown.isTrusted = true;

  hoverMarkdown.appendMarkdown(
    `## Extended Object: ${baseObjectInfo.name}\n\n`
  );
  hoverMarkdown.appendMarkdown(`**Type:** ${baseObjectInfo.type}\n\n`);
  hoverMarkdown.appendMarkdown(`**ID:** ${baseObjectInfo.id}\n\n`);
  hoverMarkdown.appendMarkdown(
    `**Source File:** ${baseObjectInfo.fileName}\n\n`
  );

  // Add additional details based on object type
  if (baseObjectInfo.type === "table" && baseObjectInfo.fields) {
    hoverMarkdown.appendMarkdown(
      `### Fields (${baseObjectInfo.fields.length}):\n\n`
    );
    baseObjectInfo.fields.slice(0, 10).forEach((field) => {
      hoverMarkdown.appendMarkdown(`- ${field.id}: ${field.name}\n`);
    });
    if (baseObjectInfo.fields.length > 10) {
      hoverMarkdown.appendMarkdown(
        `- ... ${baseObjectInfo.fields.length - 10} more fields\n`
      );
    }
  } else if (baseObjectInfo.type === "page" && baseObjectInfo.controlsCount) {
    hoverMarkdown.appendMarkdown(
      `**Controls Count:** ${baseObjectInfo.controlsCount}\n\n`
    );
  }

  // Add other extensions that also extend this object
  if (baseObjectInfo.extensions && baseObjectInfo.extensions.length > 0) {
    hoverMarkdown.appendMarkdown(
      `### Other Extensions (${baseObjectInfo.extensions.length}):\n\n`
    );
    baseObjectInfo.extensions.forEach((ext) => {
      if (ext.name !== currentExtensionName) {
        // Don't list the current extension
        hoverMarkdown.appendMarkdown(`- ${ext.name} (ID: ${ext.id})\n`);
      }
    });
  }

  // Add command to open the extended object file
  hoverMarkdown.appendMarkdown(
    `\n[Open Base Object](command:vscode.open?${encodeURIComponent(
      JSON.stringify(baseObjectInfo.uri)
    )})`
  );

  return new vscode.Hover(hoverMarkdown, hoverRange);
}

module.exports = {
  provideExtensionHover,
};
