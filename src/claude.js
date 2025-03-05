const vscode = require("vscode");
const modelHelper = require("./modelHelper");
const configManager = require("./utils/configManager");
const alFileSaver = require("./utils/alFileSaver");
const { filterToIdRanges } = require("./utils/alCodeFilter");
const {
  callClaudeApi,
  extractContentFromResponse,
} = require("./utils/claudeApiHelper");

/**
 * Get available prompts from extension configuration
 * @returns {Array} Array of prompt objects
 */
function getAvailablePrompts() {
  const configPrompts = configManager.getConfigValue("claude.prompts", []);

  // Filter out disabled prompts
  return configPrompts.filter((prompt) => !prompt.disabled);
}

/**
 * Display a prompt selection dialog
 * @returns {Promise<Object|null>} Selected prompt or null if cancelled
 */
async function showPromptSelectionDialog() {
  const prompts = getAvailablePrompts();

  if (prompts.length === 0) {
    vscode.window.showWarningMessage(
      "No Claude prompts configured. Please check your extension settings."
    );
    return null;
  }

  const items = prompts.map((prompt) => ({
    label: prompt.commandName,
    description: prompt.commandDescription || "",
    prompt: prompt,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select an operation to perform on your code",
    title: "Claude Assistance",
  });

  return selected ? selected.prompt : null;
}

/**
 * Execute a prompt with the AI model
 * @param {Object} prompt - The prompt to execute
 * @param {string} code - The code to process
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Promise<string>} Response from the AI
 */
async function executePrompt(prompt, code, progressCallback = null) {
  // Get API key from configuration
  const apiKey = configManager.getConfigValue("claude.apiKey");

  if (!apiKey || apiKey === "your-claude-api-key") {
    throw new Error(
      "Claude API key not configured. Please update your settings."
    );
  }

  // Get the model to use (from prompt or default)
  const modelId = prompt.model || configManager.getConfigValue("claude.model");
  const model =
    modelHelper.availableModels.find((m) => m.id === modelId) ||
    modelHelper.getCurrentModel();

  // Get system prompt
  const systemPrompt =
    prompt.systemPrompt ||
    configManager.getConfigValue(
      "claude.defaultSystemPrompt",
      "You are an expert AL and C/AL programming assistant for Microsoft Dynamics 365 Business Central."
    );

  // Apply ID range filtering if specified in the prompt
  let processedCode = code;
  if (prompt.idRangesOnly === true) {
    if (progressCallback) {
      progressCallback({
        increment: 5,
        message: "Filtering code to include only fields within ID ranges...",
      });
    }
    processedCode = filterToIdRanges(code);
  }

  // Replace placeholders in user prompt
  let userPrompt = prompt.userPrompt.replace("{{code}}", processedCode);

  // Replace language placeholder if present
  const defaultLanguage = configManager.getConfigValue(
    "claude.defaultLanguage",
    "en-US"
  );
  userPrompt = userPrompt.replace("{{language}}", defaultLanguage);

  // Report initial progress
  if (progressCallback) {
    progressCallback({
      increment: 10,
      message: "Sending request to Claude API...",
    });
  }

  try {
    // Get maximum tokens and temperature from config or use defaults
    const maxTokens = configManager.getConfigValue("claude.maxTokens", 4096);
    const temperature = configManager.getConfigValue("claude.temperature", 0.5);

    if (progressCallback) {
      progressCallback({
        increment: 20,
        message: `Processing with ${model.name}...`,
      });
    }

    // Make the API call to Claude
    const response = await callClaudeApi({
      apiKey,
      model: model.apiName,
      systemPrompt,
      userPrompt,
      maxTokens,
      temperature,
    });

    if (progressCallback) {
      // Don't show "Completed" message, just increment progress to 100%
      progressCallback({ increment: 70, message: "Processing response..." });
    }

    // Extract the content from the response
    const content = extractContentFromResponse(response);

    return content;
  } catch (error) {
    throw new Error(`Error calling Claude API: ${error.message}`);
  }
}

/**
 * Extract and save all AL code blocks from a response
 * @param {string} content - The response content to extract code from
 * @returns {Promise<string[]>} - Array of saved file paths
 */
async function extractAndSaveAlCodeBlocks(content) {
  // Extract all AL code blocks
  const alBlocks = alFileSaver.extractAlCodeFromMarkdown(content);

  if (alBlocks.length === 0) {
    throw new Error("No AL code blocks found in the response");
  }

  const savedFiles = [];

  // If there's only one block, save it directly
  if (alBlocks.length === 1) {
    try {
      const filePath = await alFileSaver.saveAlCodeToFile(alBlocks[0]);
      if (filePath) {
        savedFiles.push(filePath);
      }
    } catch (error) {
      throw new Error(`Failed to save AL code: ${error.message}`);
    }
    return savedFiles;
  }

  // If there are multiple blocks, handle them based on settings
  const saveMode = configManager.getConfigValue("claude.codeSaveMode", "ask");

  if (saveMode === "saveAll") {
    // Save all code blocks automatically
    for (const block of alBlocks) {
      try {
        const filePath = await alFileSaver.saveAlCodeToFile(block);
        if (filePath) {
          savedFiles.push(filePath);
        }
      } catch (error) {
        // Log the error but continue with other blocks
        vscode.window.showWarningMessage(
          `Failed to save one block: ${error.message}`
        );
      }
    }
  } else if (saveMode === "ask") {
    // Let user select which blocks to save
    const items = alBlocks.map((block, index) => {
      const info = alFileSaver.identifyAlObjectInfo(block) || {
        type: "Unknown",
        name: `Block ${index + 1}`,
      };
      return {
        label: `${info.type || "Object"} ${info.name || `#${index + 1}`}`,
        description: `${block.split("\n")[0].substring(0, 50)}...`,
        code: block,
        picked: alBlocks.length === 1, // Pre-select if there's only one
      };
    });

    const selectedItems = await vscode.window.showQuickPick(items, {
      placeHolder: "Select AL code blocks to save",
      canPickMany: true,
    });

    if (selectedItems && selectedItems.length > 0) {
      for (const item of selectedItems) {
        try {
          const filePath = await alFileSaver.saveAlCodeToFile(item.code);
          if (filePath) {
            savedFiles.push(filePath);
          }
        } catch (error) {
          vscode.window.showWarningMessage(
            `Failed to save one block: ${error.message}`
          );
        }
      }
    }
  }

  return savedFiles;
}

module.exports = {
  getAvailablePrompts,
  showPromptSelectionDialog,
  executePrompt,
  extractAndSaveAlCodeBlocks,
};
