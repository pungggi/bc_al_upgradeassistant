const vscode = require("vscode");

// Define available models with display names
const CLAUDE_MODELS = [
  {
    id: "claude-3-7-sonnet-20250219",
    label: "Claude 3.7 Sonnet - Most intelligent model",
  },
  {
    id: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet - Good balance of performance and cost",
  },
  {
    id: "claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku - Fast and efficient for daily tasks",
  },
  {
    id: "claude-3-opus-20240229",
    label: "Claude 3 Opus - Most capable model, highest cost",
  },
  {
    id: "claude-3-haiku-20240307",
    label: "Claude 3 Haiku - Original Haiku model",
  },
];

/**
 * Set the default Claude model in settings
 * @param {string} modelId - The model ID to set
 */
async function setDefaultModel(modelId) {
  try {
    // Get the configuration
    const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");

    // Update the model setting
    await config.update(
      "claude.model",
      modelId,
      vscode.ConfigurationTarget.Global
    );

    vscode.window.showInformationMessage(`Default model set to: ${modelId}`);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to set default model: ${error.message}`
    );
  }
}

/**
 * Register model-related commands
 * @param {vscode.ExtensionContext} context
 */
function registerModelCommands(context) {
  // Register a single command for setting the default model
  const setModelCommand = vscode.commands.registerCommand(
    "bc-al-upgradeassistant.setDefaultModel",
    async () => {
      // Show quick pick with model options
      const selectedModel = await vscode.window.showQuickPick(
        CLAUDE_MODELS.map((model) => ({
          label: model.label,
          description: model.id,
          model: model,
        })),
        {
          placeHolder: "Select the default Claude model",
          title: "Set Default Claude Model",
        }
      );

      if (selectedModel) {
        await setDefaultModel(selectedModel.model.id);
      }
    }
  );

  context.subscriptions.push(setModelCommand);
}

module.exports = {
  registerModelCommands,
  CLAUDE_MODELS,
};
