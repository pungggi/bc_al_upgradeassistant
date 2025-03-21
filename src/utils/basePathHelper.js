const vscode = require("vscode");

/**
 * Check if upgradedObjectFolders has a basePath already configured
 * @param {Object} configManager - Config manager instance
 * @returns {Promise<{proceed: boolean, overwrite: boolean}>} Object indicating whether to proceed and overwrite
 */
async function checkExistingBasePath(configManager) {
  const upgradedObjectFolders = configManager.getConfigValue(
    "upgradedObjectFolders",
    null
  );

  if (!upgradedObjectFolders?.basePath) {
    return { proceed: true, overwrite: true };
  }

  const options = [
    "Yes, overwrite existing configuration",
    "No, but run anyway",
    "Cancel",
  ];

  const selection = await vscode.window.showQuickPick(options, {
    placeHolder: `The setting upgradedObjectFolders already has basePath configured as: ${upgradedObjectFolders.basePath}`,
  });

  if (!selection) {
    return { proceed: false, overwrite: false };
  }

  if (selection === options[0]) {
    return { proceed: true, overwrite: true };
  } else if (selection === options[1]) {
    return { proceed: true, overwrite: false };
  } else {
    return { proceed: false, overwrite: false };
  }
}

module.exports = {
  checkExistingBasePath,
};
