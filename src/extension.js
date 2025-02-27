const vscode = require("vscode");
const {
  initializeCache,
  updateCacheForFile,
  removeFromCache,
  getCacheStats,
  isInitialized,
} = require("./cache/objectCache");
const { provideExtensionHover } = require("./providers/hoverProvider");

const {
  isEventSubscriberTemplate,
  modifyEventSubscriberTemplate,
} = require("./ALCode");

const { registerCommands } = require("./registerCommands");

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
  }, 1300);
}

function activate(context) {
  let disposable = registerCommands();

  // Initialize the cache when the extension activates
  initializeCache();

  // monitore clipboard for eventsubscribtions
  monitorClipboard();

  // Register the hover provider
  const hoverProviderDisposable = vscode.languages.registerHoverProvider("al", {
    provideHover(document, position, token) {
      return provideExtensionHover(document, position, token);
    },
  });

  // Register a command to refresh the extension info cache
  const refreshCacheDisposable = vscode.commands.registerCommand(
    "bc_al_upgradeassistant.refreshExtensionInfoCache",
    () => {
      initializeCache(true);
    }
  );

  // Register file system watcher to update the cache when AL files change
  const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.al");
  fileWatcher.onDidChange((uri) => updateCacheForFile(uri));
  fileWatcher.onDidCreate((uri) => updateCacheForFile(uri));
  fileWatcher.onDidDelete((uri) => removeFromCache(uri));

  context.subscriptions.push(
    refreshCacheDisposable,
    fileWatcher,
    hoverProviderDisposable
  );

  // Register command to refresh the object cache
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bc-al-upgradeassistant.refreshObjectCache",
      async () => {
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing AL object cache...",
            cancellable: false,
          },
          async (progress) => {
            try {
              progress.report({ message: "Scanning workspace files..." });
              await initializeCache();
              const stats = getCacheStats();

              let message = "AL object cache refreshed successfully.";
              if (stats.objectTypes) {
                const counts = Object.entries(stats.objectTypes)
                  .map(([type, count]) => `${type}: ${count}`)
                  .join(", ");
                message += ` Found ${counts}`;
              }

              vscode.window.showInformationMessage(message);
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to refresh AL object cache: ${error.message}`
              );
            }
          }
        );
      }
    )
  );

  // Initialize cache on extension activation
  if (!isInitialized()) {
    initializeCache().catch((error) => {
      console.error("Failed to initialize cache on activation:", error);
    });
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
