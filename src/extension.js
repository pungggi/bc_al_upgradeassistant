const vscode = require("vscode");
const {
  ExtendedObjectHoverProvider,
} = require("./hover/extendedObjectHoverProvider");
const symbolCache = require("./symbols/symbolCache");
const fs = require("fs");
const path = require("path");
const util = require("util");
const os = require("os");
const glob = util.promisify(require("glob"));

const {
  isEventSubscriberTemplate,
  modifyEventSubscriberTemplate,
} = require("./ALCode");
const { registerCommands } = require("./registerCommands");
const claude = require("./claude");
const { registerModelCommands } = require("./modelHelper");

// Function to monitor and modify the clipboard
async function monitorClipboard() {
  let lastClipboardContent = "";

  setInterval(async () => {
    try {
      const clipboardContent = await vscode.env.clipboard.readText();

      // Check if the clipboard has changed and matches any AL code pattern
      if (
        clipboardContent !== lastClipboardContent &&
        isEventSubscriberTemplate(clipboardContent)
      ) {
        vscode.window.showInformationMessage(clipboardContent);
        lastClipboardContent = clipboardContent;

        // Modify AL code
        const modifiedContent = modifyEventSubscriberTemplate(clipboardContent);
        vscode.window.showInformationMessage(modifiedContent);

        // Write back to clipboard
        await vscode.env.clipboard.writeText(modifiedContent);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error monitoring clipboard: ${error.message}`
      );
    }
  }, 3300);
}

async function activate(context) {
  console.log("BC/AL Upgrade Assistant is now active!");

  // Register all commands
  registerCommands(context);

  // Register model switching commands
  registerModelCommands(context);

  // Register the extended object hover provider
  const extendedObjectHoverProvider = new ExtendedObjectHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: "al", scheme: "file" },
      extendedObjectHoverProvider
    )
  );

  monitorClipboard();

  // Register the Claude prompt selection command
  let promptSelectionCommand = vscode.commands.registerCommand(
    "bc-al-upgradeassistant.selectClaudePrompt",
    async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("No active editor found");
          return;
        }

        // Get selected text or entire document
        const selection = editor.selection;
        const code = selection.isEmpty
          ? editor.document.getText()
          : editor.document.getText(selection);

        if (!code || code.trim() === "") {
          vscode.window.showInformationMessage(
            "No code selected or document is empty"
          );
          return;
        }

        // Show prompt selection dialog
        const selectedPrompt = await claude.showPromptSelectionDialog();
        if (!selectedPrompt) {
          return; // User canceled the selection
        }

        // Show progress while executing the prompt
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Running ${selectedPrompt.commandName}...`,
            cancellable: false,
          },
          async (progress) => {
            try {
              // Create progress callback
              const progressCallback = (update) => {
                if (update.increment) {
                  progress.report({
                    increment: update.increment,
                    message: update.message || "",
                  });
                }
              };

              // Call the API with progress updates
              const response = await claude.executePrompt(
                selectedPrompt,
                code,
                progressCallback
              );

              // Create a new document with the response
              const document = await vscode.workspace.openTextDocument({
                content: response,
                language: "markdown",
              });

              await vscode.window.showTextDocument(document);
            } catch (error) {
              vscode.window.showErrorMessage(
                `Error executing prompt: ${error.message}`
              );
            }
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
      }
    }
  );

  context.subscriptions.push(promptSelectionCommand);

  // Find app files to process
  await initializeSymbolCache(context);
}

async function initializeSymbolCache(context, forceRefresh = false) {
  try {
    // Get paths from settings
    const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
    let appPaths = [];

    // Common locations for .app files
    const defaultLocations = [];

    // Add workspace folders first
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const folderPath = folder.uri.fsPath;

        // Try to read .vscode/settings.json to find al.packageCachePath
        try {
          const settingsPath = path.join(
            folderPath,
            ".vscode",
            "settings.json"
          );
          if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            if (settings && settings["al.packageCachePath"]) {
              let packagePath = settings["al.packageCachePath"];
              // Handle relative paths
              if (!path.isAbsolute(packagePath)) {
                packagePath = path.join(folderPath, packagePath);
              }
              defaultLocations.push(path.join(packagePath, "*.app"));
              console.log(`Using al.packageCachePath: ${packagePath}`);
              continue; // Skip the default locations for this workspace folder
            }
          }
        } catch (err) {
          console.error(`Error reading settings.json:`, err);
        }

        // If no al.packageCachePath found, try to locate app.json
        try {
          const appJsonPath = path.join(folderPath, "app.json");
          if (fs.existsSync(appJsonPath)) {
            defaultLocations.push(
              path.join(folderPath, ".alpackages", "*.app")
            );
            console.log(`Using app.json location: ${folderPath}/.alpackages`);
            continue;
          }
        } catch (err) {
          console.error(`Error checking for app.json:`, err);
        }

        // If neither settings.json nor app.json found, use default .alpackages
        defaultLocations.push(path.join(folderPath, ".alpackages", "*.app"));
      }
    }
    for (const pattern of defaultLocations) {
      try {
        const files = await glob(pattern);
        appPaths = [...appPaths, ...files];
      } catch (err) {
        console.error(`Error finding app files with pattern ${pattern}:`, err);
      }
    }

    // Initialize the cache
    await symbolCache.initialize(appPaths);

    // If forcing refresh or cache is empty, process the app files
    let processed = 0;
    if (forceRefresh || Object.keys(symbolCache.symbols).length === 0) {
      processed = await symbolCache.processAppFiles();
      if (!forceRefresh) {
        vscode.window.showInformationMessage(
          `Processed ${processed} app files for symbols`
        );
      }
    }

    return processed;
  } catch (error) {
    console.error("Error initializing symbol cache:", error);
    vscode.window.showErrorMessage(
      `Failed to initialize symbol cache: ${error.message}`
    );
    throw error;
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  initializeSymbolCache, // Export for use in registerCommands.js
};
