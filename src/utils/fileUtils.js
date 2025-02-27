const vscode = require("vscode");
const { updateCacheForFile, removeFromCache } = require("../cache/objectCache");

/**
 * Read file content without opening a document
 * @param {vscode.Uri} uri File URI
 * @returns {Promise<string|null>} File content or null if error
 */
async function readFileContent(uri) {
  try {
    const fileData = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(fileData).toString("utf8");
  } catch (error) {
    console.error(`Error reading file ${uri.fsPath}:`, error);
    return null;
  }
}

/**
 * Setup file system watcher for AL files
 * @param {vscode.ExtensionContext} context
 */
function setupFileWatcher(context) {
  const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.al");

  fileWatcher.onDidChange((uri) => updateCacheForFile(uri));
  fileWatcher.onDidCreate((uri) => updateCacheForFile(uri));
  fileWatcher.onDidDelete((uri) => removeFromCache(uri));

  context.subscriptions.push(fileWatcher);
}

module.exports = {
  readFileContent,
  setupFileWatcher,
};
