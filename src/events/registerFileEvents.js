const fs = require("fs");
const path = require("path");
const configManager = require("../utils/configManager");
const { fileEvents } = require("../utils/alFileSaver");

function createIndexFolder() {
  try {
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );
    if (upgradedObjectFolders && upgradedObjectFolders.basePath) {
      const indexFolderPath = path.join(
        upgradedObjectFolders.basePath,
        ".index"
      );
      if (!fs.existsSync(indexFolderPath)) {
        fs.mkdirSync(indexFolderPath, { recursive: true });
        console.log(`Created index folder at: ${indexFolderPath}`);
      }
    }
  } catch (error) {
    console.error("Error creating index folder:", error);
  }
}

function registerfileEvents(context) {
  const disposable = fileEvents((fileInfo) => {
    createIndexFolder();
  });

  if (context && context.subscriptions) {
    context.subscriptions.push(disposable);
  }
}

module.exports = {
  registerfileEvents,
};
