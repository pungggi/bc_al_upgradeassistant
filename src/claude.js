const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const modelHelper = require("./modelHelper");
const configManager = require("./utils/configManager");
const alFileSaver = require("./utils/alFileSaver");
const { filterToIdRanges } = require("./utils/alCodeFilter");
const { EXTENSION_ID } = require("./constants"); // Added for config reading
const {
  callClaudeApi,
  extractContentFromResponse,
} = require("./utils/claudeApiHelper");
const { logger } = require("./utils/logger");

/**
 * Get available prompts from extension configuration
 * @returns {Array} Array of prompt objects
 */
function getAvailablePrompts() {
  const configPrompts = configManager.getConfigValue("prompts", []);

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

  // If there's only one prompt, return it directly without showing the QuickPick
  if (prompts.length === 1) {
    return prompts[0];
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
  // Determine the backend to use
  const backendSettingValue = vscode.workspace
    .getConfiguration(EXTENSION_ID)
    .get("languageModelBackend", "Claude API");

  // Get API key only if needed for Claude API
  let apiKey = null;
  if (backendSettingValue === "Claude API") {
    apiKey = configManager.getConfigValue("claude.apiKey");
    if (!apiKey || apiKey === "your-claude-api-key") {
      throw new Error(
        "Claude API key not configured for the selected backend. Please update your settings."
      );
    }
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

  // Check if debug mode is enabled
  const debugMode = configManager.getConfigValue("debugMode", false);

  // Apply ID range filtering if specified in the prompt
  let processedCode = code;
  let debugInfo = null;

  if (prompt.idRangesOnly === true) {
    if (progressCallback) {
      progressCallback({
        increment: 5,
        message: "Filtering code to include only fields within ID ranges...",
      });
    }

    if (debugMode) {
      // Get the filtered code and debug info
      const result = filterToIdRanges(code, true);
      processedCode = result.filteredCode;
      debugInfo = result;
    } else {
      processedCode = filterToIdRanges(code);
    }
  }

  // Replace placeholders in user prompt
  let userPrompt = prompt.userPrompt.replace("{{code}}", processedCode);

  // Replace language placeholder if present
  const defaultLanguage = configManager.getConfigValue(
    "defaultLanguage",
    "en-US"
  );
  userPrompt = userPrompt.replace("{{language}}", defaultLanguage);

  if (debugMode) {
    // Create debug content showing what will be sent to the AI
    const debugContent = `# AI Prompt Debug - ${prompt.commandName}

## Model
${model.name} (${model.apiName})

## System Prompt
\`\`\`
${systemPrompt}
\`\`\`

## User Prompt
\`\`\`
${userPrompt}
\`\`\`

## Configuration
- Backend: ${backendSettingValue}
${
  backendSettingValue === "Claude API"
    ? `- Max Tokens: ${configManager.getConfigValue("claude.maxTokens", 4096)}
- Temperature: ${configManager.getConfigValue("claude.temperature", 0.5)}`
    : ""
}
- ID Ranges Only: ${prompt.idRangesOnly === true ? "Yes" : "No"}
`;

    // Show debug information in a new document
    const document = await vscode.workspace.openTextDocument({
      content: debugContent,
      language: "markdown",
    });

    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true, // Keep focus on the original editor
    });

    // If we have CAL parsing debug info, save it to files
    if (debugInfo && debugInfo.originalParsed) {
      // Create debug folder if it doesn't exist
      const folderPath = path.join(
        vscode.workspace.workspaceFolders[0].uri.fsPath,
        "debug"
      );
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      // Save original parsed object
      const originalParsedPath = path.join(folderPath, "original_parsed.json");
      fs.writeFileSync(
        originalParsedPath,
        JSON.stringify(debugInfo.originalParsed, null, 2)
      );

      // Save filtered parsed object
      const filteredParsedPath = path.join(folderPath, "filtered_parsed.json");
      fs.writeFileSync(
        filteredParsedPath,
        JSON.stringify(debugInfo.filteredParsed, null, 2)
      );
    }
  }

  // Report initial progress
  if (progressCallback) {
    progressCallback({
      increment: 10,
      message: `Sending request to ${backendSettingValue}...`,
    });
  }

  try {
    let responseContent = "";

    if (backendSettingValue === "Claude API") {
      // --- Claude API Path ---
      const maxTokens = configManager.getConfigValue("claude.maxTokens", 4096);
      const temperature = configManager.getConfigValue(
        "claude.temperature",
        0.5
      );

      if (progressCallback) {
        progressCallback({
          increment: 20,
          message: `Processing with Claude (${model.name})...`,
        });
      }

      const response = await callClaudeApi({
        apiKey,
        model: model.apiName,
        systemPrompt,
        userPrompt,
        maxTokens,
        temperature,
      });

      if (progressCallback) {
        progressCallback({ increment: 70, message: "Processing response..." });
      }
      responseContent = extractContentFromResponse(response);
    } else if (backendSettingValue === "VS Code Language Model API") {
      // --- VS Code LM API Path ---
      if (!vscode.lm) {
        throw new Error(
          "VS Code Language Model API (vscode.lm) is not available in this version of VS Code."
        );
      }

      if (progressCallback) {
        progressCallback({
          increment: 20,
          message: "Processing with VS Code Language Model API...",
        });
      }

      try {
        // Shorter prompts are more reliable
        if (userPrompt.length > 10000) {
          userPrompt =
            userPrompt.substring(0, 10000) +
            "\n\n[Content truncated for size...]";
        }

        // Prepare messages for the chat model
        const messages = [];

        // Add system prompt if it exists (keep it short)
        if (systemPrompt && systemPrompt.trim()) {
          const trimmedSystemPrompt =
            systemPrompt.length > 500
              ? systemPrompt.substring(0, 500) + "..."
              : systemPrompt;

          messages.push({
            role: "system",
            content: trimmedSystemPrompt,
          });
        }

        // Add user prompt
        messages.push({
          role: "user",
          content: userPrompt,
        });

        // First get available models
        const models = await vscode.lm.selectChatModels();

        if (!models || models.length === 0) {
          throw new Error("No language models available");
        }

        // Find specified model or use the first available one
        const configModelId = configManager.getConfigValue(
          "vscodeLanguageModelId",
          ""
        );
        let selectedModel = null;

        if (configModelId) {
          selectedModel = models.find(
            (m) =>
              m.id === configModelId ||
              m.name === configModelId ||
              m.id.includes(configModelId) ||
              m.name.includes(configModelId)
          );
        }

        if (!selectedModel && models.length > 0) {
          selectedModel = models[0];
        }

        if (!selectedModel) {
          throw new Error("Could not select a language model");
        }

        // Use a longer timeout for large prompts
        const timeout = Math.min(120000, 30000 + userPrompt.length / 10);
        const cts = new vscode.CancellationTokenSource();
        setTimeout(() => cts.cancel(), timeout);

        const chatResponse = await selectedModel.sendRequest(
          messages,
          { timeout },
          cts.token
        );

        if (progressCallback) {
          progressCallback({
            increment: 40,
            message: "Receiving response...",
          });
        }

        // Process the response
        let fullResponse = "";
        if (!chatResponse || !chatResponse.stream) {
          throw new Error("Model returned invalid response format");
        }

        let chunkCount = 0;

        try {
          for await (const chunk of chatResponse.stream) {
            chunkCount++;

            // Handle different chunk formats
            if (chunk && typeof chunk === "object") {
              if (chunk.content) {
                fullResponse += chunk.content;
              } else if (chunk.text) {
                fullResponse += chunk.text;
              } else if (chunk.value) {
                fullResponse += chunk.value;
              }
            } else if (typeof chunk === "string") {
              fullResponse += chunk;
            }
          }
        } catch (streamError) {
          // If we got some content before the error, use it
          if (fullResponse && fullResponse.trim().length > 0) {
            logger.error("Stream error, but partial response received:", {
              error: streamError,
              response: fullResponse,
            });
          } else {
            throw streamError;
          }
        }

        // Retry once if we received no content
        if ((!fullResponse || fullResponse.trim() === "") && chunkCount === 0) {
          // Create a simpler prompt for retry
          const retryMessages = [
            {
              role: "system",
              content: "You are an assistant that helps with AL programming.",
            },
            {
              role: "user",
              content:
                userPrompt.substring(0, 5000) +
                "\n\n[Prompt truncated for reliability]",
            },
          ];

          // Try again with simpler prompt
          const cts2 = new vscode.CancellationTokenSource();
          setTimeout(() => cts2.cancel(), 60000); // 60 second timeout

          const retryResponse = await selectedModel.sendRequest(
            retryMessages,
            { timeout: 60000 },
            cts2.token
          );

          // Process retry response
          if (retryResponse && retryResponse.stream) {
            for await (const chunk of retryResponse.stream) {
              if (chunk && typeof chunk === "object") {
                if (chunk.content) fullResponse += chunk.content;
                else if (chunk.text) fullResponse += chunk.text;
                else if (chunk.value) fullResponse += chunk.value;
              } else if (typeof chunk === "string") {
                fullResponse += chunk;
              }
            }
          }
        }

        if (!fullResponse || fullResponse.trim() === "") {
          // Check if text property is available on the response
          if (chatResponse.text) {
            let textContent = "";
            try {
              for await (const text of chatResponse.text) {
                textContent += text;
              }
              if (textContent && textContent.trim() !== "") {
                fullResponse = textContent;
              }
            } catch (textError) {
              // Handle error in text stream
              logger.error("Error processing text stream:", textError);
            }
          }

          // If still empty, throw error
          if (!fullResponse || fullResponse.trim() === "") {
            throw new Error(
              "Received an empty response from the VS Code Language Model API"
            );
          }
        }

        if (progressCallback) {
          progressCallback({
            increment: 30,
            message: "Processing response...",
          });
        }

        responseContent = fullResponse;
      } catch (err) {
        // Check for common error conditions
        if (err.message && err.message.includes("consent")) {
          throw new Error(
            "The model requires user consent. Please accept the prompt in VS Code."
          );
        }

        if (err.message && err.message.includes("quota")) {
          throw new Error("You've exceeded your quota limits for this model.");
        }

        if (err instanceof vscode.LanguageModelError) {
          throw new Error(`VS Code LM error: ${err.message}`);
        } else {
          throw err;
        }
      }
    } else {
      throw new Error(
        `Unsupported language model backend: ${backendSettingValue}`
      );
    }

    return responseContent;
  } catch (error) {
    // Add backend info to the error message
    const backendInfo =
      backendSettingValue === "Claude API" ? "Claude API" : "VS Code LM API";
    throw new Error(`Error calling ${backendInfo}: ${error.message}`);
  }
}

/**
 * Extract and save all AL code blocks from a response
 * @param {string} content - The response content to extract code from
 * @returns {Promise<string[]>} - Array of saved file paths
 */
async function extractAndSaveAlCodeBlocks(content, orginFilePath) {
  // Extract all AL code blocks
  const alBlocks = alFileSaver.extractAlCodeFromMarkdown(content);

  if (alBlocks.length === 0) {
    throw new Error("No AL code blocks found in the response");
  }

  const savedFiles = [];

  // If there's only one block, save it directly
  if (alBlocks.length === 1) {
    try {
      const filePath = await alFileSaver.saveAlCodeToFile(
        alBlocks[0],
        orginFilePath
      );
      if (filePath) {
        savedFiles.push(filePath);
      }
    } catch (error) {
      throw new Error(`Failed to save AL code: ${error.message}`);
    }
    return savedFiles;
  }

  // If there are multiple blocks, handle them based on settings
  const saveMode = configManager.getConfigValue("codeSaveMode", "ask");

  if (saveMode === "saveAll") {
    // Save all code blocks automatically
    for (const block of alBlocks) {
      try {
        const filePath = await alFileSaver.saveAlCodeToFile(
          block,
          orginFilePath
        );
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
          const filePath = await alFileSaver.saveAlCodeToFile(
            item.code,
            orginFilePath
          );
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
