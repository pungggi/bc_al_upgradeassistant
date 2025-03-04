const vscode = require("vscode");
const symbolCache = require("../symbols/symbolCache");

class ExtendedObjectHoverProvider {
  async provideHover(document, position) {
    console.log("Hover provider triggered at position:", position);

    // Get the current line text
    const lineText = document.lineAt(position.line).text;
    console.log("Line text:", lineText);

    // Regular expressions to match various extension types
    const extensionRegexes = [
      /(\w+extension\s+\d+\s+".+?"\s+extends\s+)"(.+?)"/, // For pageextension, tableextension, etc.
      /(\w+\s+\d+\s+".+?"\s+extends\s+)"(.+?)"/, // For page, table extends format
    ];

    for (const regex of extensionRegexes) {
      const match = lineText.match(regex);
      if (!match) continue;

      console.log("Found match:", match);

      // Get the position of the extended object name
      const extendedNameStart = lineText.indexOf(
        match[2],
        lineText.indexOf("extends")
      );
      const extendedNameEnd = extendedNameStart + match[2].length;

      // Check if the hover position is within the extended name
      if (
        position.character >= extendedNameStart &&
        position.character <= extendedNameEnd
      ) {
        const range = new vscode.Range(
          new vscode.Position(position.line, extendedNameStart),
          new vscode.Position(position.line, extendedNameEnd)
        );

        // Get the extended object name and look up its ID
        const objectName = match[2];
        console.log("Looking up object ID for:", objectName);
        const objectId = symbolCache.getObjectId(objectName);
        console.log("Found object ID:", objectId);

        const hoverContent = [
          `**${objectName}**`,
          `${objectId ? `ID ${objectId}` : ""}`,
        ];

        return new vscode.Hover(hoverContent, range);
      }
    }

    return null;
  }
}

module.exports = {
  ExtendedObjectHoverProvider,
};
