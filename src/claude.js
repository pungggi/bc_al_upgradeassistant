const vscode = require("vscode");

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

  // Create QuickPick items from the available prompts
  const promptItems = prompts.map((prompt) => ({
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
 * @returns {Promise<string>} The response from Claude
 */
async function executePrompt(prompt, code) {
  // Placeholder for Claude API integration
  // This would be implemented to call the Claude API with the prompt
  vscode.window.showInformationMessage(
    `Executing ${prompt.commandName} with Claude API`
  );

  // Replace token in the prompt with actual code
  const userPrompt = prompt.userPrompt.replace("{{code}}", code);

  // Get the API key
  const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
  const apiKey = config.get("claude.apiKey");

  if (!apiKey || apiKey === "your-claude-api-key") {
    throw new Error(
      "Claude API key is not configured. Please set it in the extension settings."
    );
  }

  // TODO: Implement actual Claude API call here

  return `Claude API response for ${prompt.commandName}`;
}

module.exports = {
  getAvailablePrompts,
  showPromptSelectionDialog,
  executePrompt,
};
