const vscode = require("vscode");

/**
 * Supported Claude models
 */
const CLAUDE_MODELS = {
  SONNET_37: "claude-3-7-sonnet-20250219", // Claude 3.7 Sonnet - Most intelligent
  SONNET_35: "claude-3-5-sonnet-20241022", // Claude 3.5 Sonnet
  HAIKU_35: "claude-3-5-haiku-20241022", // Claude 3.5 Haiku - Fast, efficient default
  OPUS: "claude-3-opus-20240229", // Claude 3 Opus - Powerful but expensive
  HAIKU: "claude-3-haiku-20240307", // Original Claude 3 Haiku
};

/**
 * Get a user-friendly name for a Claude model
 * @param {string} modelId The model identifier
 * @returns {string} A user-friendly name for the model
 */
function getModelFriendlyName(modelId) {
  switch (modelId) {
    case CLAUDE_MODELS.SONNET_37:
      return "Claude 3.7 Sonnet";
    case CLAUDE_MODELS.SONNET_35:
      return "Claude 3.5 Sonnet";
    case CLAUDE_MODELS.HAIKU_35:
      return "Claude 3.5 Haiku";
    case CLAUDE_MODELS.OPUS:
      return "Claude 3 Opus";
    case CLAUDE_MODELS.HAIKU:
      return "Claude 3 Haiku";
    default:
      return `Unknown Model (${modelId})`;
  }
}

/**
 * Check if a model ID is valid
 * @param {string} modelId The model identifier to validate
 * @returns {boolean} True if valid
 */
function isValidModel(modelId) {
  return Object.values(CLAUDE_MODELS).includes(modelId);
}

/**
 * Get the default Claude model from settings
 * @returns {string} The model ID
 */
function getDefaultModel() {
  const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
  return config.get("claude.model") || CLAUDE_MODELS.HAIKU_35; // Default is now Claude 3.5 Haiku
}

/**
 * Register commands to quickly change models
 * @param {vscode.ExtensionContext} context
 */
function registerModelCommands(context) {
  // Register a command for each model
  for (const [key, modelId] of Object.entries(CLAUDE_MODELS)) {
    const command = vscode.commands.registerCommand(
      `bc-al-upgradeassistant.setModel${key}`,
      async () => {
        const config = vscode.workspace.getConfiguration(
          "bc-al-upgradeassistant"
        );
        await config.update("claude.model", modelId, true);
        vscode.window.showInformationMessage(
          `Default Claude model set to ${getModelFriendlyName(modelId)}`
        );
      }
    );
    context.subscriptions.push(command);
  }
}

module.exports = {
  CLAUDE_MODELS,
  getModelFriendlyName,
  isValidModel,
  getDefaultModel,
  registerModelCommands,
};
