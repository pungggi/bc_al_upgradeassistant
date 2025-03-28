const vscode = require("vscode");
const {
  guessTableType,
  findTableTypeInVariableDeclarations,
} = require("../utils/fieldCollector");

/**
 * Provides code actions for AL Record trigger operations like Insert, Modify, Delete, Rename
 */
class RecordTriggerActionProvider {
  static triggerNames = ["Insert", "Modify", "Delete", "Rename"];

  /**
   * Provide code actions for the given document
   * @param {vscode.TextDocument} document The document in which the command was invoked
   * @param {vscode.Range | vscode.Selection} range The range for which the command was invoked
   * @returns {vscode.CodeAction[] | undefined} Array of code actions or undefined
   */
  provideCodeActions(document, range) {
    const line = document.lineAt(range.start.line).text;
    const actions = [];

    // Record trigger pattern: variableName.(Insert|Modify|Delete|Rename|Validate)
    const triggerMatch = line.match(
      /(\w+)\.(Insert|Modify|Delete|Rename|Validate)(\(.*?\))?/
    );
    if (!triggerMatch) {
      return undefined;
    }

    const [, variableName, triggerName] = triggerMatch;

    // Get document text
    const documentText = document.getText();

    // Find table name immediately for simple cases
    let tableName = findTableTypeInVariableDeclarations(
      documentText,
      variableName
    );

    // Create code action
    const action = new vscode.CodeAction(
      `Copy subscriber info to clipboard`,
      vscode.CodeActionKind.QuickFix
    );

    // If not found, use the asynchronous approach with a placeholder
    if (!tableName) {
      tableName = "Record";

      // Start async lookup but don't wait for it
      this.findTableNameAsync(
        document,
        documentText,
        variableName,
        triggerName,
        action
      );
    } else {
      if (!triggerName) {
        return;
      }
      // Update the action with the found table name
      let procedureName = "Tab";
      procedureName += tableName.replace(/[^a-zA-Z0-9]/g, ""); // SalesHeader

      // Initialize fieldName before using it
      let fieldName = "";

      if (triggerMatch[3] && triggerName === "Validate") {
        const validateContent = triggerMatch[3];
        fieldName = validateContent
          .substring(
            validateContent.indexOf("(") + 1,
            validateContent.lastIndexOf(",")
          )
          .trim();
        // Remove quotes if present at the beginning and end
        fieldName = fieldName.replace(/^"|"$/g, "");
        procedureName += `_${fieldName}`; // _SellToCustomerNo
      } else {
        // For other triggers, append the trigger name directly
        procedureName += `_${triggerName}`; // _Insert, _Modify, etc.
      }

      const fullEventName = `OnBefore${triggerName}Event`;

      const recordName = tableName.includes(" ") ? `"${tableName}"` : tableName; // "Sales Header" but Item

      let additionalParameters = "";
      if (["Modify", "Rename"].includes(triggerName)) {
        additionalParameters = `; var xRec: Record ${recordName}; RunTrigger: Boolean`;
      }

      const codeSnippet = `[EventSubscriber(ObjectType::Table, Database::${recordName}, ${fullEventName}, ${
        fieldName ? `'${fieldName}'` : "''"
      }, false, false)]
local procedure ${procedureName}(var Rec: Record ${recordName}${additionalParameters})
begin
end;`;

      action.command = {
        command: "bc-al-upgradeassistant.copyTriggerInfo",
        title: `Subscribe to ${triggerName.toLowerCase()} trigger`,
        arguments: [codeSnippet],
      };
    }

    actions.push(action);
    return actions;
  }

  /**
   * Asynchronously finds the table name and updates the action
   * @param {vscode.TextDocument} document Document being analyzed
   * @param {string} documentText Document text content
   * @param {string} variableName Name of the record variable
   * @param {string} triggerName Name of the trigger (Insert, Modify, etc.)
   * @param {vscode.CodeAction} action Action to update when table name is found
   */
  findTableNameAsync(
    document,
    documentText,
    variableName,
    triggerName,
    action
  ) {
    return new Promise((resolve) => {
      // Try to guess table type using all available methods
      guessTableType(documentText, variableName)
        .then((tableName) => {
          const tableNameResult = tableName || "Record";

          // Update the command with the resolved table name
          action.command = {
            command: "bc-al-upgradeassistant.copyTriggerInfo",
            title: "Copy trigger info",
            arguments: [
              `${tableNameResult}-trigger ${triggerName.toLowerCase()}`,
            ],
          };
          resolve();
        })
        .catch((error) => {
          console.error(`Error finding table name for ${variableName}:`, error);

          // Fallback to generic action
          action.command = {
            command: "bc-al-upgradeassistant.copyTriggerInfo",
            title: "Copy trigger info",
            arguments: [`Record-trigger ${triggerName.toLowerCase()}`],
          };
          resolve();
        });
    });
  }
}

module.exports = { RecordTriggerActionProvider };
