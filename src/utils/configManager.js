const vscode = require("vscode");

/**
 * Configuration manager for the Upgrade Assistant using VSCode's built-in settings
 */
class ConfigManager {
  constructor() {
    // Match the extension ID with the one in package.json (uses hyphens)
    this.extensionId = "bc-al-upgradeassistant";
  }

  /**
   * Gets the current configuration
   * @returns {vscode.WorkspaceConfiguration} The current configuration object
   */
  getConfig() {
    return vscode.workspace.getConfiguration(this.extensionId);
  }

  /**
   * Updates a specific configuration setting
   * @param {string} setting - The configuration setting to update
   * @param {any} value - The value to save
   * @returns {Thenable<void>}
   */
  updateConfig(setting, value) {
    return this.getConfig().update(setting, value);
  }

  /**
   * Gets a specific configuration value
   * @param {string} setting - The configuration setting to get
   * @param {any} defaultValue - Default value if setting not found
   * @returns {any} The requested configuration value or default if not found
   */
  getConfigValue(setting, defaultValue = null) {
    return this.getConfig().get(setting, defaultValue);
  }
}

module.exports = new ConfigManager();
