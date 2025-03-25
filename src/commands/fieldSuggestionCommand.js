const vscode = require("vscode");
const fieldCollector = require("../utils/fieldCollector");
const stringSimilarity = require("../utils/stringSimilarity");

/**
 * Suggest field names at the current cursor position
 * @param {string} [recordName] - Optional record name (if already known)
 * @param {string} [fieldName] - Optional field name (if already known)
 */
async function suggestFieldNames(recordName, fieldName) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "al") {
    vscode.window.showInformationMessage(
      "Please open an AL file to use field suggestions"
    );
    return;
  }

  // If record and field names weren't provided, try to determine them from cursor position
  if (!recordName || !fieldName) {
    const position = editor.selection.active;
    const lineText = editor.document.lineAt(position.line).text;

    // Use the full line text for pattern matching instead of truncating at cursor
    const fullLineText = lineText;

    // Find all record.field patterns in the line
    const recordFieldPattern =
      /(\w+)\.(?:"([^"]+)"|'([^']+)'|([^\s.,;()[\]{}]+))/g;

    // let bestMatch = null;
    // let bestMatchDistance = Infinity;
    let match;

    // Find the record.field pattern closest to the cursor position
    while ((match = recordFieldPattern.exec(fullLineText)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;

      // Check if cursor is within or near this match
      if (position.character >= matchStart && position.character <= matchEnd) {
        // Cursor is inside the match - perfect!
        // bestMatch = match;
        break;
      }

      // Calculate distance from cursor to this match
      //   const distance = Math.min(
      //     Math.abs(position.character - matchStart),
      //     Math.abs(position.character - matchEnd)
      //   );

      //   if (distance < bestMatchDistance) {
      //     bestMatchDistance = distance;
      //     bestMatch = match;
      //   }
    }

    // if (bestMatch && bestMatchDistance < 50) {
    // Only use matches reasonably close to cursor
    recordName = match[1]; // Variable name
    // Get the field name from whichever capturing group matched (quoted or unquoted)
    fieldName = match[2] || match[3] || match[4];
    // }
  }

  // Get the document text for variable lookup
  const documentText = editor.document.getText();

  // Look for the variable definition in the document
  const variableName = recordName; // Store original variable name

  // Improved regex to handle line breaks and multiple spaces
  const varDefinitionPattern = new RegExp(
    `\\bvar\\s+${variableName}\\s*:\\s*Record\\s+["']?([\\w\\s]+)["']?\\b`,
    "i"
  );

  // Also improved this regex to handle line breaks and quotes around type name
  const paramDefinitionPattern = new RegExp(
    `\\b${variableName}\\s*:\\s*Record\\s+["']?([\\w\\s]+)["']?\\b`,
    "i"
  );

  let varMatch = documentText.match(varDefinitionPattern);
  if (varMatch && varMatch[1]) {
    recordName = varMatch[1].trim(); // Use the actual record type name and trim whitespace
  } else {
    // Try to find it as a parameter
    let paramMatch = documentText.match(paramDefinitionPattern);
    if (paramMatch && paramMatch[1]) {
      recordName = paramMatch[1].trim(); // Use the actual record type name and trim whitespace
    }
    // If we didn't find it, we'll keep using the variable name and let guess TableType handle it
  }

  // Determine the table type for this record - properly await the Promise
  let tableType = await fieldCollector.guessTableType(
    documentText,
    variableName
  );

  // If we couldn't determine the table type automatically, try to scan workspace
  if (!tableType) {
    // First try to find the table type in other open documents
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "al") {
        const docTableType = await fieldCollector.guessTableType(
          doc.getText(),
          variableName
        );
        if (docTableType) {
          tableType = docTableType;
          break;
        }
      }
    }
  }

  // If still no table type, search in workspace files
  if (!tableType) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Searching for table type of record '${recordName}'`,
        cancellable: false,
      },
      async (progress) => {
        try {
          const alFiles = await vscode.workspace.findFiles(
            "**/*.al",
            "**/node_modules/**"
          );

          let filesChecked = 0;
          const totalFiles = alFiles.length;

          for (const file of alFiles) {
            filesChecked++;
            if (filesChecked % 50 === 0) {
              progress.report({
                message: `Checked ${filesChecked}/${totalFiles} files`,
              });
            }

            try {
              const content = await vscode.workspace.fs.readFile(file);
              const text = Buffer.from(content).toString("utf8");

              // Skip if file is too large (avoid performance issues)
              if (text.length > 1000000) continue;

              const fileTableType = await fieldCollector.guessTableType(
                text,
                variableName
              );
              if (fileTableType) {
                tableType = fileTableType;
                break;
              }
            } catch (error) {
              console.error(`Error reading file ${file.fsPath}:`, error);
            }
          }
        } catch (error) {
          console.error("Error searching workspace:", error);
        }
      }
    );
  }

  // If we still couldn't determine the table type, ask the user as last resort
  if (!tableType) {
    const tables = await fieldCollector.getAllKnownTables();

    if (tables.length === 0) {
      vscode.window.showErrorMessage(
        "No table definitions found. Check source extraction path configuration."
      );
      return;
    }

    tableType = await vscode.window.showQuickPick(tables, {
      placeHolder: `Select table type for '${recordName}'`,
    });

    if (!tableType) return;
  }

  // Get fields for the table
  const validFields = await fieldCollector.getFieldsForTable(tableType);

  if (!validFields || validFields.length === 0) {
    vscode.window.showInformationMessage(
      `No fields found for table '${tableType}'`
    );
    return;
  }

  // Find similar fields (get more suggestions for this view)
  const suggestions = stringSimilarity.findSimilarFieldNames(
    fieldName,
    validFields,
    10
  );

  if (suggestions.length === 0) {
    vscode.window.showInformationMessage(
      `No similar fields found for '${fieldName}'`
    );
    return;
  }

  // Show quick pick with field suggestions
  const selected = await vscode.window.showQuickPick(
    suggestions.map((field) => ({
      label: field,
      description: `Replace '${fieldName}' with '${field}'`,
    })),
    { placeHolder: `Select a field to replace '${fieldName}'` }
  );

  if (!selected) return;

  // Apply the selected suggestion
  await editor.edit((editBuilder) => {
    // Find the current occurrence of the field name
    const document = editor.document;
    const text = document.getText();

    // Create a pattern to find variableName.fieldName (note we use the original variable name)
    // This handles cases with and without quotes
    const pattern = new RegExp(
      `${variableName}\\.(?:["'])?${fieldName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )}(?:["'])?`,
      "g"
    );

    let match;
    while ((match = pattern.exec(text)) !== null) {
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      // Check if our cursor is near this occurrence
      if (editor.selection.active.line === startPos.line) {
        // Determine if the selected field needs quotes
        const needsQuotes =
          selected.label.includes(" ") || selected.label.includes("-");
        const replacement = `${variableName}.${
          needsQuotes ? `"${selected.label}"` : selected.label
        }`;

        editBuilder.replace(range, replacement);
        break;
      }
    }
  });

  vscode.window.showInformationMessage(
    `Changed field to '${selected.label}' (Table: ${tableType})`
  );
}

module.exports = {
  suggestFieldNames,
};
