const vscode = require("vscode");
const symbolCache = require("../symbolCache");
const { extractReportLayouts, extractReportExtensionLayouts } = require("../../utils/alLayoutParser");

class ExtendedObjectHoverProvider {
  provideCodeLenses(document) {
    const codeLenses = [];
    const documentText = document.getText(); // Get full document text once for parsing

    // This simple flag logic might not be robust for nested structures or complex files.
    // Consider parsing the document to identify object scopes more accurately if issues arise.
    let inReportObjectScope = false; 
    let inReportExtensionObjectScope = false;

    for (let i = 0; i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;

      const reportRegex = /^\s*report\s+\d+\s+"[^"]+"/i;
      const reportExtensionRegex = /^\s*reportextension\s+\d+\s+"[^"]+"/i;

      if (reportRegex.test(lineText)) {
        inReportObjectScope = true; // Entered a report object definition
        inReportExtensionObjectScope = false; // Reset other scope

        const layouts = extractReportLayouts(documentText);
        if (layouts && layouts.length > 0) {
          const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, lineText.length));
          const title = layouts.length === 1 ? "Open Report Layout" : `Open Report Layouts (${layouts.length})`;
          const codeLens = new vscode.CodeLens(range, {
            title: title,
            command: "bc-al-upgradeassistant.openLayoutFileExternally",
            arguments: [layouts.map(layout => ({ ...layout, path: vscode.Uri.joinPath(document.uri, '..', layout.path).fsPath }))]
          });
          codeLenses.push(codeLens);
        }
      } else if (reportExtensionRegex.test(lineText)) {
        inReportExtensionObjectScope = true; // Entered a report extension object definition
        inReportObjectScope = false; // Reset other scope

        const layouts = extractReportExtensionLayouts(documentText);
        if (layouts && layouts.length > 0) {
          const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, lineText.length));
          const title = layouts.length === 1 ? "Open Report Extension Layout" : `Open Report Extension Layouts (${layouts.length})`;
          const codeLens = new vscode.CodeLens(range, {
            title: title,
            command: "bc-al-upgradeassistant.openLayoutFileExternally",
             arguments: [layouts.map(layout => ({ ...layout, path: vscode.Uri.joinPath(document.uri, '..', layout.path).fsPath }))]
          });
          codeLenses.push(codeLens);
        }
      }

      // Simple scope reset logic: assumes objects don't span across the entire remaining file
      // and that a new object definition implies the previous one has ended.
      // A more robust solution would involve proper AL syntax parsing.
      // Reset scope if we hit a line that looks like a new top-level object definition or end of file
      if ((lineText.trim().match(/^(page|table|codeunit|query|xmlport|enum|interface|controladdin|permissionset) /i) && (inReportObjectScope || inReportExtensionObjectScope)) || i === document.lineCount -1 ){
          inReportObjectScope = false;
          inReportExtensionObjectScope = false;
      }
      
      // Regular expressions to match various extension types (existing logic)
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
        const range = new vscode.Range(
          new vscode.Position(i, extendedNameStart),
          new vscode.Position(i, extendedNameEnd)
        );

        // Look up the object ID using the symbol cache
        const objectName = match[2];
        const objectId = symbolCache.getObjectId(objectName);
        if (objectId) {
          // Create a CodeLens to annotate the extended object with its ID
          const codeLens = new vscode.CodeLens(range, {
            title: `ID ${objectId}`,
            command: "",
          });
          codeLenses.push(codeLens);

          // Break after first match to prevent duplicates
          break;
        }
      }
    }
    return codeLenses;
  }

  resolveCodeLens(codeLens) {
    return codeLens;
  }
}

module.exports = ExtendedObjectHoverProvider;
