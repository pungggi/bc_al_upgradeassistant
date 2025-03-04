const vscode = require("vscode");
const axios = require("axios");
const {
  CLAUDE_MODELS,
  isValidModel,
  getDefaultModel,
  getModelFriendlyName,
} = require("./modelHelper");

/**
 * Get available Claude prompts from the extension configuration
 * @returns {Array} Array of prompt configurations
 */
function getAvailablePrompts() {
  const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
  return config.get("claude.prompts") || [];
}

/**
 * Show a quick pick dialog to select a prompt command
 * @returns {Promise<Object|null>} Selected prompt or null if canceled
 */
async function showPromptSelectionDialog() {
  const prompts = getAvailablePrompts();

  if (!prompts || prompts.length === 0) {
    vscode.window.showInformationMessage(
      "No prompts are configured. Please add prompts in the settings."
    );
    return null;
  }

  // Filter out disabled prompts
  const enabledPrompts = prompts.filter((prompt) => prompt.disabled !== true);

  if (enabledPrompts.length === 0) {
    vscode.window.showInformationMessage(
      "All configured prompts are disabled. Please enable at least one prompt in the settings."
    );
    return null;
  }

  // Create QuickPick items from the available prompts
  const promptItems = enabledPrompts.map((prompt) => ({
    label: prompt.commandName,
    description: prompt.commandDescription || prompt.userPrompt.split("\n")[0], // Use commandDescription if available, otherwise fall back to first line of userPrompt
    detail: "", // No longer showing example in the dialog
    prompt: prompt,
  }));

  // Show quick pick dialog
  const selection = await vscode.window.showQuickPick(promptItems, {
    placeHolder: "Select a Claude prompt to execute",
    matchOnDescription: true,
    matchOnDetail: false,
  });

  return selection ? selection.prompt : null;
}

/**
 * Execute the selected prompt with Claude API
 * @param {Object} prompt The selected prompt configuration
 * @param {string} code The code to process with the prompt
 * @param {Function} progressCallback Optional callback for progress updates
 * @returns {Promise<string>} The response from Claude
 */
async function executePrompt(prompt, code, progressCallback) {
  // Get the API key and configuration
  const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
  const apiKey = config.get("claude.apiKey");
  const defaultSystemPrompt = config.get("claude.defaultSystemPrompt");

  // Get the model - use prompt-specific model if available, otherwise use the default
  const defaultModel = getDefaultModel();
  let useModel = prompt.model || defaultModel;

  // Validate model name
  if (!isValidModel(useModel)) {
    console.warn(
      `Unrecognized Claude model: "${useModel}", falling back to default model "${defaultModel}"`
    );
    vscode.window.showWarningMessage(
      `Unrecognized Claude model: "${useModel}", falling back to default model.`
    );
    useModel = defaultModel;
  }

  if (!apiKey || apiKey === "your-claude-api-key") {
    throw new Error(
      "Claude API key is not configured. Please set it in the extension settings."
    );
  }

  // Replace token in the prompt with actual code
  const userPrompt = prompt.userPrompt.replace("{{code}}", code);

  // Use the provided system prompt or fall back to the default
  const systemPrompt = prompt.systemPrompt || defaultSystemPrompt;

  try {
    if (progressCallback) {
      progressCallback({
        increment: 5,
        message: `Using ${getModelFriendlyName(useModel)}...`,
      });
    }

    // Prepare request to Claude API
    const response = await callClaudeAPI(
      apiKey,
      systemPrompt,
      userPrompt,
      useModel,
      progressCallback
    );
    return response;
  } catch (error) {
    console.error("Error calling Claude API:", error);

    // Provide more helpful error messages
    if (error.response) {
      const status = error.response.status;
      if (status === 401) {
        throw new Error(
          "Authentication failed. Please check your Claude API key."
        );
      } else if (status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      } else if (status === 500) {
        throw new Error("Claude API server error. Please try again later.");
      } else {
        throw new Error(
          `Claude API error (${status}): ${
            error.response.data.error?.message || "Unknown error"
          }`
        );
      }
    }

    throw new Error(`Error: ${error.message || "Unknown error occurred"}`);
  }
}

/**
 * Call the Claude API with the given prompts
 * @param {string} apiKey The Claude API key
 * @param {string} systemPrompt System instructions for Claude
 * @param {string} userPrompt The user's message
 * @param {string} model Claude model to use
 * @param {Function} progressCallback Optional callback for progress updates
 * @returns {Promise<string>} Claude's response
 */
async function callClaudeAPI(
  apiKey,
  systemPrompt,
  userPrompt,
  model,
  progressCallback
) {
  // Claude API endpoint
  const apiUrl = "https://api.anthropic.com/v1/messages";

  // Headers for Claude API
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  // Request body
  const requestBody = {
    model: model, // Use the specified model
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
    system: systemPrompt,
  };

  // If progress callback is provided, update the progress
  if (progressCallback) {
    progressCallback({
      increment: 10,
      message: `Sending request to Claude (${model})...`,
    });
  }

  // Send the request to Claude API
  const response = await axios.post(apiUrl, requestBody, { headers });

  if (progressCallback) {
    progressCallback({
      increment: 90,
      message: "Processing Claude's response...",
    });
  }

  // Extract and format the response
  if (
    response.data &&
    response.data.content &&
    response.data.content.length > 0
  ) {
    // Process all content blocks and join them
    const formattedResponse = response.data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n\n");

    return formattedResponse;
  }

  return "No response content received from Claude.";
}

module.exports = {
  getAvailablePrompts,
  showPromptSelectionDialog,
  executePrompt,
  callClaudeAPI,
};
