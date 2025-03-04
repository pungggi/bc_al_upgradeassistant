const vscode = require("vscode");
const configManager = require("./utils/configManager");
const { getModelDataFromPackage } = require("./utils/packageReader");

/**
 * Get available AI models from package.json configuration
 * @returns {Array} List of available models
 */
function getAvailableModels() {
  try {
    // Get models directly from package.json
    const models = getModelDataFromPackage();

    if (models.length === 0) {
      console.warn("No models found in package.json");
      return [];
    }

    return models.map((model) => {
      const { id, name, description, apiName } = model;
      return {
        id,
        name,
        description: description || "Claude model",
        apiName,
      };
    });
  } catch (error) {
    console.error("Error parsing model configuration:", error);
    return [];
  }
}

// Initialize with empty array to prevent errors if accessed before vscode is ready
let availableModels = [];

/**
 * Initialize available models
 * This should be called early in the extension activation
 */
function initializeModels() {
  availableModels = getAvailableModels();
  console.log(`Initialized ${availableModels.length} AI models`);
  return availableModels;
}

/**
 * Get the default model configuration
 * @returns {Object} The default model configuration
 */
function getDefaultModel() {
  const defaultModelId = vscode.workspace
    .getConfiguration("bc-al-upgradeassistant")
    .get("claude.model");

  const model = availableModels.find((m) => m.id === defaultModelId);

  if (model) {
    return model;
  }

  // Return first available model if default isn't found
  return availableModels.length > 0
    ? availableModels[0]
    : {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Default fallback model",
        apiName: "claude-3-5-sonnet-20241022",
      };
}

/**
 * Get the currently selected model
 * @returns {Object} The currently selected model
 */
function getCurrentModel() {
  const savedModelId = configManager.getConfigValue("claude.model");
  if (savedModelId) {
    const model = availableModels.find((m) => m.id === savedModelId);
    if (model) {
      return model;
    }
  }
  return getDefaultModel();
}

/**
 * Set the current model
 * @param {string} modelId - ID of the model to set as current
 * @returns {Promise<boolean>} Whether the operation succeeded
 */
async function setCurrentModel(modelId) {
  try {
    const model = availableModels.find((m) => m.id === modelId);
    if (model) {
      await configManager.updateConfig("claude.model", modelId, true);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error setting model:", error);
    return false;
  }
}

/**
 * Display model selection dialog
 * @returns {Promise<Object|null>} Selected model or null if cancelled
 */
async function selectModel() {
  const currentModel = getCurrentModel();

  const items = availableModels.map((model) => ({
    label: model.name,
    description: model.description,
    detail: model.id === currentModel.id ? "Currently selected" : "",
    model: model,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select AI model",
    title: "Choose AI Model",
  });

  if (selected) {
    await setCurrentModel(selected.model.id);
    return selected.model;
  }

  return null;
}

module.exports = {
  availableModels,
  getAvailableModels,
  initializeModels,
  getDefaultModel,
  getCurrentModel,
  setCurrentModel,
  selectModel,
};
