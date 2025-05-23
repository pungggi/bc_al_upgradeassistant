const vscode = require("vscode");
const symbolCache = require("../symbolCache");
const {
  extractReportLayouts,
  extractReportExtensionLayouts,
} = require("../utils/alLayoutParser");
const { logger } = require("../utils/logger");

/**
 * Hover provider for AL objects that shows layout information and object IDs
 */
class ALObjectHoverProvider {
  /**
   * Provide hover information for AL objects
   * @param {vscode.TextDocument} document - The document
   * @param {vscode.Position} position - The position
   * @param {vscode.CancellationToken} token - Cancellation token
   * @returns {vscode.Hover | null} - The hover information
   */
  async provideHover(document, position) {
    try {
      logger.info(
        `[Hover] Providing hover for ${document.uri.fsPath} at line ${
          position.line + 1
        }, character ${position.character}`
      );

      // Check if the document is an AL file
      if (document.languageId !== "al") {
        logger.info(
          `[Hover] Document is not an AL file (languageId: ${document.languageId})`
        );
        return null;
      }

      const line = document.lineAt(position);
      const lineText = line.text;

      logger.info(`[Hover] Line text: "${lineText}"`);

      // Check for report declarations
      const reportHover = this.checkReportDeclaration(
        document,
        position,
        lineText
      );
      if (reportHover) {
        return reportHover;
      }

      // Check for report extension declarations
      const reportExtHover = this.checkReportExtensionDeclaration(
        document,
        position,
        lineText
      );
      if (reportExtHover) {
        return reportExtHover;
      }

      // Check for extends clauses
      const extendsHover = this.checkExtendsClause(
        document,
        position,
        lineText
      );
      if (extendsHover) {
        return extendsHover;
      }

      return null;
    } catch (error) {
      logger.error("[Hover] Error providing hover:", error);
      return null;
    }
  }

  /**
   * Check if the position is on a report declaration and provide hover
   * @param {vscode.TextDocument} document - The document
   * @param {vscode.Position} position - The position
   * @param {string} lineText - The line text
   * @returns {vscode.Hover | null} - The hover information
   */
  checkReportDeclaration(document, position, lineText) {
    const reportRegex = /^\s*report\s+\d+\s+("([^"]+)"|[^\s"]+)/i;
    const match = lineText.match(reportRegex);

    if (!match) {
      return null;
    }

    // Check if the cursor is within the report declaration
    const reportStart = lineText.indexOf("report");
    const reportEnd = lineText.length;

    if (position.character < reportStart || position.character > reportEnd) {
      return null;
    }

    logger.info("[Hover] Found report declaration, extracting layouts");

    const layouts = extractReportLayouts(document.getText());
    return this.createReportLayoutHover(layouts, "Report");
  }

  /**
   * Check if the position is on a report extension declaration and provide hover
   * @param {vscode.TextDocument} document - The document
   * @param {vscode.Position} position - The position
   * @param {string} lineText - The line text
   * @returns {vscode.Hover | null} - The hover information
   */
  checkReportExtensionDeclaration(document, position, lineText) {
    const reportExtRegex = /^\s*reportextension\s+\d+\s+"[^"]+"/i;
    const match = lineText.match(reportExtRegex);

    if (!match) {
      return null;
    }

    // Check if the cursor is within the report extension declaration
    const reportExtStart = lineText.indexOf("reportextension");
    const reportExtEnd = lineText.length;

    if (
      position.character < reportExtStart ||
      position.character > reportExtEnd
    ) {
      return null;
    }

    logger.info(
      "[Hover] Found report extension declaration, extracting layouts"
    );

    const layouts = extractReportExtensionLayouts(document.getText());
    return this.createReportLayoutHover(layouts, "Report Extension");
  }

  /**
   * Check if the position is on an extends clause and provide hover
   * @param {vscode.TextDocument} document - The document
   * @param {vscode.Position} position - The position
   * @param {string} lineText - The line text
   * @returns {vscode.Hover | null} - The hover information
   */
  checkExtendsClause(document, position, lineText) {
    // Regular expressions to match various extension types
    const extensionRegexes = [
      /(\w+extension\s+\d+\s+".+?"\s+extends\s+)"(.+?)"/, // For pageextension, tableextension, etc.
      /(\w+\s+\d+\s+".+?"\s+extends\s+)"(.+?)"/, // For page, table extends format
    ];

    for (const regex of extensionRegexes) {
      const match = lineText.match(regex);
      if (!match) continue;

      // Get the position of the extended object name
      const extendedNameStart = lineText.indexOf(
        match[2],
        lineText.indexOf("extends")
      );
      const extendedNameEnd = extendedNameStart + match[2].length;

      // Check if the cursor is within the extended object name
      if (
        position.character < extendedNameStart ||
        position.character > extendedNameEnd
      ) {
        continue;
      }

      // Look up the object ID using the symbol cache
      const objectName = match[2];
      const objectId = symbolCache.getObjectId(objectName);

      logger.info(
        `[Hover] Found extends clause for ${objectName}, ID: ${
          objectId || "not found"
        }`
      );

      return this.createExtendsHover(objectName, objectId);
    }

    return null;
  }

  /**
   * Create hover content for report layouts
   * @param {Array} layouts - The layouts array
   * @param {string} objectType - The object type (Report or Report Extension)
   * @returns {vscode.Hover} - The hover information
   */
  createReportLayoutHover(layouts, objectType) {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    markdown.appendMarkdown(`### 📊 ${objectType} Layouts\n\n`);

    if (layouts.length === 0) {
      markdown.appendMarkdown(`*No layouts found*\n\n`);
    } else {
      layouts.forEach((layout) => {
        const command = `command:bc-al-upgradeassistant.openLayoutFileExternally?${encodeURIComponent(
          JSON.stringify([layout])
        )}`;
        markdown.appendMarkdown(
          `- 📄 **${layout.label}** [Open](${command})\n`
        );
      });
    }

    logger.info(`[Hover] Created layout hover with ${layouts.length} layouts`);

    return new vscode.Hover(markdown);
  }

  /**
   * Create hover content for extends clauses
   * @param {string} objectName - The extended object name
   * @param {string|null} objectId - The object ID
   * @returns {vscode.Hover} - The hover information
   */
  createExtendsHover(objectName, objectId) {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    markdown.appendMarkdown(`### 🔗 Extended Object\n\n`);
    markdown.appendMarkdown(`**Object:** ${objectName}\n\n`);

    if (objectId) {
      markdown.appendMarkdown(`**ID:** ${objectId}\n\n`);
    } else {
      markdown.appendMarkdown(`**ID:** *Not found in symbol cache*\n\n`);
      markdown.appendMarkdown(
        `*Try refreshing the symbol cache if this object should exist.*\n\n`
      );
    }

    logger.info(
      `[Hover] Created extends hover for ${objectName} (ID: ${
        objectId || "not found"
      })`
    );

    return new vscode.Hover(markdown);
  }
}

module.exports = ALObjectHoverProvider;
