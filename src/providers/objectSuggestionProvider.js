const vscode = require("vscode");
const symbolCache = require("../symbolCache");
const stringSimilarity = require("../utils/stringSimilarity");

/**
 * Extract information about the invalid object name from a variable declaration
 * @param {vscode.TextDocument} document - The document
 * @param {vscode.Range} range - The range of the error
 * @returns {Object|null} - Object with variable name, object type, incorrect name, and range
 */
function extractObjectInfo(document, range) {
  if (!document || !range) {
    return null;
  }

  // Get the line text
  const lineText = document.lineAt(range.start.line).text;
  console.log("Analyzing line:", lineText);

  // First, try to match a variable declaration with a quoted object name
  // Pattern: "var: Type "Name";" or "var: Type 'Name';"
  const quotedPattern =
    /^(\s*\w+\s*:\s*)([A-Z][\w]*)\s+(["'])([^"']+)(["'])\s*;/;
  let match = lineText.match(quotedPattern);

  if (match) {
    // We have a variable with a quoted object name
    const [, prefix, objType, openQuote, objectName, closeQuote] = match;
    console.log("Matched quoted pattern:", {
      prefix,
      objType,
      openQuote,
      objectName,
      closeQuote,
    });

    // Find the position of the object name in the line
    const prefixLength = prefix.length + objType.length + 1; // +1 for the space after type
    const startPos = prefixLength + openQuote.length;
    const endPos = startPos + objectName.length;

    return {
      variableName: match[0].split(":")[0].trim(),
      objectType: objType,
      incorrectName: objectName,
      quoteChar: openQuote,
      isQuoted: true,
      range: new vscode.Range(
        new vscode.Position(range.start.line, startPos),
        new vscode.Position(range.start.line, endPos)
      ),
    };
  }

  // If no match with quotes, try to match a variable declaration with an unquoted object name
  // Pattern: "var: Type Name;"
  const unquotedPattern = /^(\s*\w+\s*:\s*)([A-Z][\w]*)\s+([A-Za-z0-9_]+)\s*;/;
  match = lineText.match(unquotedPattern);

  if (match) {
    // We have a variable with an unquoted object name
    const [, prefix, objType, objectName] = match;
    console.log("Matched unquoted pattern:", { prefix, objType, objectName });

    // Find the position of the object name in the line
    const prefixLength = prefix.length + objType.length + 1; // +1 for the space after type
    const startPos = prefixLength;
    const endPos = startPos + objectName.length;

    return {
      variableName: match[0].split(":")[0].trim(),
      objectType: objType,
      incorrectName: objectName,
      isQuoted: false,
      range: new vscode.Range(
        new vscode.Position(range.start.line, startPos),
        new vscode.Position(range.start.line, endPos)
      ),
    };
  }

  console.log("No pattern matched for line:", lineText);
  return null;
}

/**
 * Code Action Provider for object name suggestions
 */
class ObjectSuggestionActionProvider {
  /**
   * Provide code actions for diagnostics
   * @param {vscode.TextDocument} document - The document
   * @param {vscode.Range} range - The range
   * @param {vscode.CodeActionContext} context - The context
   * @returns {vscode.CodeAction[]} - The code actions
   */
  async provideCodeActions(document, range, context) {
    console.log("ObjectSuggestionActionProvider: provideCodeActions called");

    // No diagnostics or not AL file, no actions
    if (!context.diagnostics || context.diagnostics.length === 0) {
      console.log("No diagnostics found");
      return [];
    }

    // Log all diagnostics for debugging
    context.diagnostics.forEach((d, i) => {
      console.log(`Diagnostic ${i + 1}:`, {
        code: d.code,
        message: d.message,
        severity: d.severity,
        range: {
          start: {
            line: d.range.start.line,
            character: d.range.start.character,
          },
          end: { line: d.range.end.line, character: d.range.end.character },
        },
      });
    });

    // Find AL0185 diagnostics
    const matchingDiagnostics = context.diagnostics.filter((d) => {
      console.log("Checking diagnostic:", {
        code: d.code,
        message: d.message,
        source: d.source,
      });
      return (
        d.code === "AL0185" ||
        (typeof d.code === "object" && d.code.value === "AL0185")
      );
    });

    if (matchingDiagnostics.length === 0) {
      console.log("No AL0185 diagnostics found");
      return [];
    }

    const actions = [];

    for (const diagnostic of matchingDiagnostics) {
      // Try to extract object info from the diagnostic
      const objectInfo = extractObjectInfo(document, diagnostic.range);

      if (!objectInfo) {
        console.log("Could not extract object info from diagnostic");
        continue;
      }

      const {
        objectType,
        incorrectName,
        isQuoted,
        range: replacementRange,
      } = objectInfo;

      // Get all symbols from cache
      const allSymbols = Object.values(symbolCache.symbols);

      console.log("Symbols:", allSymbols);

      // Map AL types to symbol types
      const typeMapping = {
        record: "table",
        xmlport: "xmlPort",
        dotnet: "dotNetPackage",
        controladdin: "controlAddIn",
        pageext: "pageExtension",
        tableext: "tableExtension",
        reportext: "reportExtension",
      };

      const symbolType =
        typeMapping[objectType.toLowerCase()] ||
        (objectType.toLowerCase().endsWith("extension")
          ? objectType.toLowerCase()
          : objectType.toLowerCase());

      console.log(
        `Mapped object type '${objectType}' to symbol type '${symbolType}'`
      );

      // Filter symbols by object type
      const matchingSymbols = allSymbols.filter((symbol) => {
        if (!symbol.Type) {
          console.log(`[Filter] Symbol without Type:`, symbol);
          return false;
        }

        // Check both normalized type and original type array name
        const symbolType_lower = symbolType.toLowerCase();
        const type_lower = symbol.Type.toLowerCase();
        const originalType_lower = symbol.OriginalType
          ? symbol.OriginalType.toLowerCase()
          : "";

        const symbolTypeMatches = type_lower === symbolType_lower;
        const originalTypeMatches =
          originalType_lower.startsWith(symbolType_lower);
        const matches = symbolTypeMatches || originalTypeMatches;

        return matches;
      });

      if (!matchingSymbols || matchingSymbols.length === 0) {
        console.log(`No symbols found for type '${objectType}'`);
        continue;
      }

      // Find similar object names
      const names = matchingSymbols.map((s) => s.Name);
      console.log("Finding similar names:", {
        incorrectName,
        availableNames: names,
        matchingSymbolsCount: matchingSymbols.length,
      });

      // --- BEGIN TIMING LOG ---
      const startTime = performance.now();
      console.log(
        `[Timing] Calling findSimilarNames for '${incorrectName}' with ${names.length} names...`
      );
      // --- END TIMING LOG ---
      const suggestions = stringSimilarity.findSimilarNames(
        incorrectName,
        names
      );
      // --- BEGIN TIMING LOG ---
      const endTime = performance.now();
      console.log(
        `[Timing] findSimilarNames took ${(endTime - startTime).toFixed(2)} ms`
      );
      // --- END TIMING LOG ---

      console.log("Found suggestions:", suggestions);

      // Create a code action for each suggestion
      if (!suggestions || suggestions.length === 0) {
        console.log("No suggestions found for:", incorrectName);
        continue;
      }

      console.log(`Creating ${suggestions.length} code actions`);
      for (const suggestion of suggestions) {
        const title = `Change to '${suggestion}'`;
        console.log(`Creating code action: ${title}`);
        const action = new vscode.CodeAction(
          title,
          vscode.CodeActionKind.QuickFix
        );

        // Set diagnostic so VS Code knows which error this fixes
        action.diagnostics = [diagnostic];

        // Create the edit to replace the object name
        const edit = new vscode.WorkspaceEdit();

        // Create the appropriate replacement based on whether the original was quoted
        let replacement;

        if (isQuoted) {
          // If the original was quoted, preserve the same quote style
          replacement = suggestion;
        } else {
          // If the original was not quoted, only add quotes if needed
          const needsQuotes =
            suggestion.includes(" ") || suggestion.includes("-");
          replacement = needsQuotes ? `"${suggestion}"` : suggestion;
        }

        edit.replace(document.uri, replacementRange, replacement);
        action.edit = edit;
        action.isPreferred = suggestions.indexOf(suggestion) === 0; // Make first suggestion preferred

        actions.push(action);
      }
    }

    return actions;
  }
}

module.exports = {
  ObjectSuggestionActionProvider,
};
