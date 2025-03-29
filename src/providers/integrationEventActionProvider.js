const vscode = require("vscode");

/**
 * Parses an AL parameter string into an array of objects.
 * Example input: 'var IncomingDocument: Record "Incoming Document"; var IsHandled: Boolean'
 * Example output: [
 *   { name: 'IncomingDocument', type: 'Record "Incoming Document"', isVar: true },
 *   { name: 'IsHandled', type: 'Boolean', isVar: true }
 * ]
 * @param {string} paramString The parameter string from the procedure signature.
 * @returns {Array<{name: string, type: string, isVar: boolean}>}
 */
function parseAlParameters(paramString) {
  if (!paramString || paramString.trim() === "") {
    return [];
  }

  const params = [];
  // Split parameters by semicolon, handling potential semicolons within types (e.g., Dictionary<Text; Text>) - less common in older AL but good practice
  // A simpler split for typical AL:
  const paramDeclarations = paramString
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p);

  const paramRegex = /^\s*(var\s+)?([\w"]+)\s*:\s*(.+?)\s*$/i;

  for (const decl of paramDeclarations) {
    const match = decl.match(paramRegex);
    if (match) {
      const isVar = !!match[1]; // Check if 'var ' exists
      const name = match[2];
      const type = match[3].trim(); // Trim trailing spaces from type
      params.push({ name, type, isVar });
    } else {
      console.warn(`Could not parse parameter declaration: ${decl}`);
      // Add a placeholder or skip? Skipping for now.
    }
  }
  return params;
}

/**
 * Provides code actions for generating AL Integration Event subscribers.
 */
class IntegrationEventActionProvider {
  /**
   * Provide code actions for the given document and range.
   * @param {vscode.TextDocument} document The document in which the command was invoked.
   * @param {vscode.Range | vscode.Selection} range The range or selection for which the command was invoked.
   * @returns {vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]>}
   */
  provideCodeActions(document, range) {
    const line = document.lineAt(range.start.line);
    const lineText = line.text.trim();

    // Regex to match a procedure call like: ProcedureName(param1, param2); or ProcedureName();
    // It captures the procedure name.
    const callMatch = lineText.match(/^(\w+)\s*\((.*?)\)\s*;?\s*$/);
    if (!callMatch) {
      return undefined;
    }

    const calledProcedureName = callMatch[1];
    const documentText = document.getText();

    // Regex to find the Integration Event definition
    // It captures the parameter list string within the definition's parentheses.
    // Handles optional 'local' keyword.
    const definitionRegex = new RegExp(
      `\\[\\s*IntegrationEvent\\s*\\(.*\\)\\s*\\]\\s*(?:local\\s+)?procedure\\s+${calledProcedureName}\\s*\\((.*?)\\)`,
      "is" // i: case-insensitive, s: dot matches newline (for parameters spanning lines)
    );
    const definitionMatch = documentText.match(definitionRegex);

    if (!definitionMatch) {
      return undefined;
    }

    const publisherParamString = definitionMatch[1].trim();
    const publisherParams = parseAlParameters(publisherParamString);

    // Regex to find the publisher object definition (Codeunit, Page, etc.)
    // Captures: 1=ObjectType, 2=ObjectID, 3=QuotedName|UnquotedName, 4=QuotedName, 5=UnquotedName
    const objectRegex =
      /^\s*(codeunit|page|table|report|query|xmlport)\s+(\d+)\s+("([^"]+)"|([a-zA-Z0-9_]+))/im;
    const objectMatch = documentText.match(objectRegex);

    if (!objectMatch) {
      console.warn("Could not find publisher object definition in the file.");
      return undefined; // Cannot proceed without publisher info
    }

    const publisherObjectType = objectMatch[1];
    // const publisherObjectId = objectMatch[2]; // Not strictly needed for subscriber
    const publisherObjectName = objectMatch[4] || objectMatch[5]; // Prefer quoted name if exists
    const formattedPublisherObjectName = objectMatch[4]
      ? `"${publisherObjectName}"`
      : publisherObjectName;

    // Construct the subscriber procedure name
    const subscriberProcedureName = `Subscribe${calledProcedureName}`; // Simple naming convention

    // Construct the subscriber parameter list string
    let subscriberParamsString = `var Sender: ${publisherObjectType} ${formattedPublisherObjectName}`;
    publisherParams.forEach((param) => {
      subscriberParamsString += `; ${param.isVar ? "var " : ""}${param.name}: ${
        param.type
      }`;
    });

    // Construct the full snippet
    const snippet = `[EventSubscriber(ObjectType::${publisherObjectType}, ${publisherObjectType}::${formattedPublisherObjectName}, '${calledProcedureName}', '', false, false)]
local procedure ${subscriberProcedureName}(${subscriberParamsString})
begin
end;`;

    // Create the Code Action
    const action = new vscode.CodeAction(
      `Generate Event Subscriber for '${calledProcedureName}'`,
      vscode.CodeActionKind.RefactorExtract // Or QuickFix if preferred
    );

    action.command = {
      command: "al.copyIntegrationEventSubscriber", // Command to be registered
      title: "Copy Integration Event Subscriber Snippet",
      tooltip: "Copies the generated event subscriber code to the clipboard.",
      arguments: [snippet],
    };

    return [action];
  }
}

module.exports = { IntegrationEventActionProvider, parseAlParameters }; // Export helper for potential testing
