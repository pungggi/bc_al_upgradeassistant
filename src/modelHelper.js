const vscode = require("vscode");
const configManager = require("./utils/configManager");

/**
 * Available AI models
 */
const availableModels = [
  {
    id: "claude-3-opus-20240229",
    name: "Claude 3 Opus",
    description: "Most powerful for complex tasks",
    apiName: "claude-3-opus-20240229",
  },
  {
    id: "claude-3-sonnet-20240229",
    name: "Claude 3 Sonnet",
    description: "Balance of intelligence and speed",
    apiName: "claude-3-sonnet-20240229",
  },
  {
    id: "claude-3-haiku-20240307",
    name: "Claude 3 Haiku",
    description: "Fastest and most compact model",
    apiName: "claude-3-haiku-20240307",
  },
  {
    id: "claude-2.0",
    name: "Claude 2",
    description: "Previous generation model",
    apiName: "claude-2.0",
  },
  {
    id: "claude-instant-1.2",
    name: "Claude Instant",
    description: "Low-latency model for simple tasks",
    apiName: "claude-instant-1.2",
  },
];

/**
 * Get the default model configuration
 * @returns {Object} The default model configuration
 */
function getDefaultModel() {
  return {
    id: "claude-3-sonnet-20240229",
    name: "Claude 3 Sonnet",
    description: "Balance of intelligence and speed",
    apiName: "claude-3-sonnet-20240229",
  };
}

/**
 * Get the currently selected model
 * @returns {Object} The currently selected model
 */
function getCurrentModel() {
  const savedModelId = configManager.getConfigValue("selectedModel");
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
      await configManager.updateConfig("selectedModel", modelId);
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
  getDefaultModel,
  getCurrentModel,
  setCurrentModel,
  selectModel,
};
