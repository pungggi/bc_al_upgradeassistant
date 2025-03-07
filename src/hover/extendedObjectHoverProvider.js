const vscode = require("vscode");
const symbolCache = require("../symbolCache");

class ExtendedObjectHoverProvider {
  provideCodeLenses(document) {
    const codeLenses = [];
    for (let i = 0; i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;

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
