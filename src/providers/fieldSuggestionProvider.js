const vscode = require("vscode");
const fieldCollector = require("../utils/fieldCollector");
const stringSimilarity = require("../utils/stringSimilarity");
const { logger } = require("../utils/logger");

/**
 * Extract information about the invalid field reference
 * @param {vscode.TextDocument} document - The document
 * @param {vscode.Range} range - The range of the error
 * @returns {Object|null} - Object with record name and field name, or null
 */
function extractFieldInfo(document, range) {
  if (!document || !range) {
    return null;
  }

  // Get the line text
  const lineText = document.lineAt(range.start.line).text;

  // Get the context around the error
  const errorStart = Math.max(0, range.start.character - 20);
  const errorEnd = Math.min(lineText.length, range.end.character + 20);
  const errorContext = lineText.substring(errorStart, errorEnd);

  // More inclusive pattern for record.field, handling various formats
  // This will catch Record.Field, Record."Field with spaces", etc.
  const recordFieldPattern = /(\w+)\.(?:["']([^"']+)["']|([.\w]+))/g;
  let match;
  let bestMatch = null;
  let bestDistance = Infinity;

  while ((match = recordFieldPattern.exec(lineText)) !== null) {
    const recordVariableName = match[1];
    const fieldName = match[2] || match[3]; // Either quoted or unquoted field
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    // Check if this match overlaps with our error range
    if (
      matchStart <= range.end.character &&
      matchEnd >= range.start.character
    ) {
      // This match directly overlaps with the error - best possible match
      return {
        recordVariableName,
        fieldName,
        range: new vscode.Range(
          new vscode.Position(range.start.line, matchStart),
          new vscode.Position(range.start.line, matchEnd)
        ),
      };
    }

    // If not directly overlapping, keep track of the closest match
    const distance = Math.min(
      Math.abs(matchStart - range.start.character),
      Math.abs(matchEnd - range.end.character)
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = {
        recordVariableName,
        fieldName,
        range: new vscode.Range(
          new vscode.Position(range.start.line, matchStart),
          new vscode.Position(range.start.line, matchEnd)
        ),
      };
    }
  }

  // If we found any match within a reasonable distance, return it
  if (bestMatch && bestDistance < 50) {
    return bestMatch;
  }

  // Try to extract from the error message itself as a last resort
  const document_error_message = document.getText(range);
  logger.info(
    `[FieldSuggestion] Error context: ${errorContext}, Error message: ${document_error_message}`
  );

  return null;
}

/**
 * Code Action Provider for field name suggestions
 */
class FieldSuggestionActionProvider {
  /**
   * Provide code actions for diagnostics
   * @param {vscode.TextDocument} document - The document
   * @param {vscode.Range} range - The range
   * @param {vscode.CodeActionContext} context - The context
   * @returns {vscode.CodeAction[]} - The code actions
   */
  async provideCodeActions(document, range, context) {
    // No diagnostics or not AL file, no actions
    if (
      !context.diagnostics ||
      context.diagnostics.length === 0 ||
      document.languageId !== "al"
    ) {
      return [];
    }

    // Debug: Log diagnostic information to help troubleshoot
    logger.info(
      `[FieldSuggestion] Found ${
        context.diagnostics.length
      } diagnostics at line ${range.start.line + 1}`
    );
    context.diagnostics.forEach((d, idx) => {
      logger.info(
        `[FieldSuggestion] Diagnostic ${idx + 1}: ${d.message}, code: ${
          d.code
        }, severity: ${d.severity}`
      );
    });

    // Find diagnostics that match any common field error patterns
    const matchingDiagnostics = context.diagnostics.filter((d) => {
      const message = d.message.toLowerCase();
      return (
        message.includes("does not contain a definition for") ||
        (message.includes("field") && message.includes("does not exist")) ||
        message.includes("unknown field") ||
        message.includes("field not found") ||
        message.includes("cannot be resolved") ||
        message.includes("is not found") ||
        message.includes("is inaccessible") ||
        message.includes("identifier not found")
      );
    });

    if (matchingDiagnostics.length === 0) {
      logger.info(
        "[FieldSuggestion] No matching diagnostics found for field suggestion"
      );
      return [];
    }

    const actions = [];

    for (const diagnostic of matchingDiagnostics) {
      // Try to extract field info from the diagnostic
      const fieldInfo = extractFieldInfo(document, diagnostic.range);

      if (!fieldInfo) {
        logger.info(
          "[FieldSuggestion] Could not extract field info from diagnostic"
        );
        continue;
      }

      const { recordVariableName, fieldName } = fieldInfo;

      // Try to determine the table type for this record
      // Make sure to properly await the Promise
      logger.verbose(
        `[FieldSuggestion] Trying to guess table type for record variable: '${recordVariableName}'`
      );
      const tableType = await fieldCollector.guessTableType(
        document.getText(),
        recordVariableName
      );
      logger.info(
        `[FieldSuggestion] Guessed table type: '${tableType}' for record variable: '${recordVariableName}'`
      );

      if (!tableType) {
        // Add action to manually trigger suggestion
        logger.verbose(
          `[FieldSuggestion] No table type found for record variable: '${recordVariableName}'`
        );
        const manualAction = new vscode.CodeAction(
          `Find similar fields for '${fieldName}'...`,
          vscode.CodeActionKind.QuickFix
        );
        manualAction.command = {
          command: "bc-al-upgradeassistant.suggestFieldNames",
          title: "Find similar fields",
          arguments: [recordVariableName, fieldName],
        };
        manualAction.diagnostics = [diagnostic]; // Associate with the diagnostic
        actions.push(manualAction);
        continue;
      }

      // Get all fields for this table
      logger.info(`[FieldSuggestion] Getting fields for table: '${tableType}'`);
      // Remove await since getFieldsForTable is now synchronous
      const validFields = fieldCollector.getFieldsForTable(tableType);
      logger.info(
        `[FieldSuggestion] Found ${
          validFields ? validFields.length : 0
        } fields for table '${tableType}'`
      );

      if (!validFields || validFields.length === 0) {
        logger.verbose(
          `[FieldSuggestion] No fields found for table '${tableType}'`
        );
        continue;
      }

      logger.verbose(
        `[FieldSuggestion] Finding similar field names for '${fieldName}'`
      );
      const suggestions = stringSimilarity.findSimilarNames(
        fieldName,
        validFields
      );
      logger.verbose(
        `[FieldSuggestion] Found field suggestions: ${suggestions.join(", ")}`
      );

      // Use fieldInfo.range instead of diagnostic.range for more accurate replacement
      const replacementRange = fieldInfo.range || diagnostic.range;

      // Create a code action for each suggestion
      for (const suggestion of suggestions) {
        const action = new vscode.CodeAction(
          `Change to '${suggestion}'`,
          vscode.CodeActionKind.QuickFix
        );

        // Set diagnostic so VS Code knows which error this fixes
        action.diagnostics = [diagnostic];

        // Create the edit to replace the field name
        const edit = new vscode.WorkspaceEdit();

        // Determine if we need to add quotes
        const needsQuotes =
          suggestion.includes(" ") || suggestion.includes("-");

        // Only replace the field part, not the record name
        const originalText = document.getText(replacementRange);
        const dotIndex = originalText.indexOf(".");

        let replacement;
        if (dotIndex !== -1) {
          const recordPart = originalText.substring(0, dotIndex + 1);
          replacement =
            recordPart + (needsQuotes ? `"${suggestion}"` : suggestion);
        } else {
          // Fallback if we can't find the dot
          replacement = needsQuotes ? `"${suggestion}"` : suggestion;
        }

        edit.replace(document.uri, replacementRange, replacement);
        action.edit = edit;
        action.isPreferred = true; // Make first suggestion preferred

        actions.push(action);
      }

      // Add a "More suggestions..." action that calls our custom command
      const moreAction = new vscode.CodeAction(
        "More suggestions...",
        vscode.CodeActionKind.QuickFix
      );
      moreAction.command = {
        command: "bc-al-upgradeassistant.suggestFieldNames",
        title: "More field suggestions",
        arguments: [recordVariableName, fieldName],
      };
      moreAction.diagnostics = [diagnostic]; // Associate with the diagnostic
      actions.push(moreAction);
    }

    return actions;
  }
}

module.exports = {
  FieldSuggestionActionProvider,
};
