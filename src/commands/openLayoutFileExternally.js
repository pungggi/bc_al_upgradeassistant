const vscode = require("vscode");

/**
 * Opens the specified file path(s) using vscode.env.openExternal.
 * If filePathOrPaths is "placeholder_path", it shows an informational message.
 * If it's an array of layout objects, it handles single or multiple layouts (using QuickPick).
 * @param {string | Array<{label: string, path: string}>} filePathOrPaths
 */
async function openLayoutFileExternally(filePathOrPaths) {
  if (filePathOrPaths === "placeholder_path" || (Array.isArray(filePathOrPaths) && filePathOrPaths.length > 0 && filePathOrPaths[0].path === "placeholder_path")) {
    // Handle the single placeholder_path case for reports (which is wrapped in an array now)
    // or the direct "placeholder_path" string for compatibility if used directly by old code.
     let actualPath = "placeholder_path";
     if(Array.isArray(filePathOrPaths) && filePathOrPaths.length > 0) {
         actualPath = filePathOrPaths[0].path; // Use path from the object
     }

    if (actualPath === "placeholder_path") {
        vscode.window.showInformationMessage(
            "Opening layout file is not fully implemented yet. Please complete AL parsing logic."
        );
        return;
    }
    // If actualPath is not "placeholder_path" but came from a single array element, it will be handled below.
  }
  
  // Handling for placeholder_path_ext1, placeholder_path_ext2 for reportextension
  if (Array.isArray(filePathOrPaths) && filePathOrPaths.length > 0 && filePathOrPaths.some(p => p.path.startsWith("placeholder_path_ext"))) {
      if (filePathOrPaths.every(p => p.path.startsWith("placeholder_path_"))) {
        vscode.window.showInformationMessage(
            "Opening layout file is not fully implemented yet. This is a placeholder for multiple layouts. Please complete AL parsing logic."
        );
        return;
      }
  }


  if (typeof filePathOrPaths === 'string') { // Should ideally not happen if called from new CodeLens
    // This handles the direct string "placeholder_path" or any other direct string path
    if (filePathOrPaths === "placeholder_path") {
         vscode.window.showInformationMessage(
            "Opening layout file is not fully implemented yet. Please complete AL parsing logic."
        );
        return;
    }
    // For any other string, try to open it directly (legacy or direct call)
    await attemptToOpenFile(filePathOrPaths);
    return;
  }

  if (!Array.isArray(filePathOrPaths) || filePathOrPaths.length === 0) {
    vscode.window.showErrorMessage(
      "Invalid or empty file path(s) provided."
    );
    return;
  }

  const validPaths = filePathOrPaths.filter(
    (item) => item && typeof item.label === 'string' && typeof item.path === 'string'
  );

  if (validPaths.length === 0) {
    vscode.window.showErrorMessage("No valid layout file paths found.");
    return;
  }

  if (validPaths.length === 1) {
    // If it's a placeholder, show message, otherwise open.
    if (validPaths[0].path === "placeholder_path" || validPaths[0].path.startsWith("placeholder_path_ext")) {
         vscode.window.showInformationMessage(
            "Opening layout file is not fully implemented yet. Please complete AL parsing logic."
        );
        return;
    }
    await attemptToOpenFile(validPaths[0].path);
  } else {
    // Multiple paths, use QuickPick
    const items = validPaths.map((layout) => ({
      label: layout.label,
      description: layout.path, // Store path in description to retrieve later
      path: layout.path // Keep path for direct access
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a layout file to open",
    });

    if (selected && selected.path) {
        // If it's a placeholder, show message, otherwise open.
        if (selected.path === "placeholder_path" || selected.path.startsWith("placeholder_path_ext")) {
            vscode.window.showInformationMessage(
                "Opening layout file is not fully implemented yet. This is a placeholder for multiple layouts. Please complete AL parsing logic."
            );
            return;
        }
      await attemptToOpenFile(selected.path);
    }
  }
}

async function attemptToOpenFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    vscode.window.showErrorMessage("Invalid file path provided for opening external file.");
    return;
  }
  // Prevent opening actual "placeholder_path" or "placeholder_path_ext*" strings
  if (filePath === "placeholder_path" || filePath.startsWith("placeholder_path_ext")) {
    vscode.window.showInformationMessage(
        "Opening layout file is not fully implemented yet. Please complete AL parsing logic (attemptToOpenFile)."
    );
    return;
  }

  try {
    const uri = vscode.Uri.file(filePath);
    const success = await vscode.env.openExternal(uri);
    if (!success) {
      vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error opening external file: ${filePath}`, error);
    vscode.window.showErrorMessage(
      `An error occurred while trying to open file: ${filePath}. ${error.message}`
    );
  }
}

module.exports = {
  openLayoutFileExternally,
};
