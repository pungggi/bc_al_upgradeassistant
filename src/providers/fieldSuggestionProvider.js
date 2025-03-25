const vscode = require("vscode");
const fieldCollector = require("../utils/fieldCollector");
const stringSimilarity = require("../utils/stringSimilarity");

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

  // Find pattern like "RecordVar.FieldName" at or around the error position
  const recordFieldPattern = /(\w+)\.(["'])?([^"'\s.,;()[\]{}]+)(["'])?/g;
  let match;

  while ((match = recordFieldPattern.exec(lineText)) !== null) {
    // Check if this match contains our position
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    if (
      matchStart <= range.start.character &&
      matchEnd >= range.end.character
    ) {
      const recordName = match[1];
      const fieldName = match[3];

      return { recordName, fieldName };
    }
  }

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

    // Find diagnostics that match our pattern
    const matchingDiagnostics = context.diagnostics.filter((d) =>
      d.message.includes("does not contain a definition for")
    );

    if (matchingDiagnostics.length === 0) {
      return [];
    }

    const actions = [];

    for (const diagnostic of matchingDiagnostics) {
      const fieldInfo = extractFieldInfo(document, diagnostic.range);

      if (!fieldInfo) {
        continue;
      }

      const { recordName, fieldName } = fieldInfo;

      // Try to determine the table type for this record
      // Make sure to properly await the Promise
      const tableType = await fieldCollector.guessTableType(
        document.getText(),
        recordName
      );

      if (!tableType) {
        // Add action to manually trigger suggestion
        const manualAction = new vscode.CodeAction(
          `Find similar fields for '${fieldName}'...`,
          vscode.CodeActionKind.QuickFix
        );
        manualAction.command = {
          command: "bc-al-upgradeassistant.suggestFieldNames",
          title: "Find similar fields",
          arguments: [recordName, fieldName],
        };
        actions.push(manualAction);
        continue;
      }

      // Get all fields for this table
      const validFields = await fieldCollector.getFieldsForTable(tableType);

      if (!validFields || validFields.length === 0) {
        continue;
      }

      // Find similar field names
      const suggestions = stringSimilarity.findSimilarFieldNames(
        fieldName,
        validFields
      );

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
        const replacement = needsQuotes ? `"${suggestion}"` : suggestion;

        edit.replace(document.uri, diagnostic.range, replacement);
        action.edit = edit;

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
        arguments: [recordName, fieldName],
      };
      actions.push(moreAction);
    }

    return actions;
  }
}

module.exports = {
  FieldSuggestionActionProvider,
};
