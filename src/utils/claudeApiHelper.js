const axios = require("axios");

/**
 * Anthropic Claude API constants
 */
const CLAUDE_API = {
  BASE_URL: "https://api.anthropic.com/v1/messages",
  VERSION: "2023-06-01", // Anthropic API version
};

/**
 * Call the Claude API with a structured prompt
 *
 * @param {Object} options - Claude API options
 * @param {string} options.apiKey - Claude API key
 * @param {string} options.model - Claude model to use
 * @param {string} options.systemPrompt - System prompt for Claude
 * @param {string} options.userPrompt - User prompt for Claude
 * @param {number} options.maxTokens - Maximum tokens to generate (defaults to 4096)
 * @param {number} options.temperature - Temperature for generation (defaults to 0.7)
 * @returns {Promise<Object>} - Claude API response
 */
async function callClaudeApi({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  maxTokens = 4096,
  temperature = 0.7,
}) {
  if (!apiKey) {
    throw new Error("Claude API key is required");
  }

  // Validate required parameters
  if (!model || !userPrompt) {
    throw new Error("Model and userPrompt are required");
  }

  try {
    const response = await axios.post(
      CLAUDE_API.BASE_URL,
      {
        model: model,
        max_tokens: maxTokens,
        temperature: temperature,
        system: systemPrompt || "",
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": CLAUDE_API.VERSION,
          "x-api-key": apiKey,
        },
      }
    );

    return response.data;
  } catch (error) {
    // Handle API-specific errors
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      if (status === 401) {
        throw new Error("Authentication error: Invalid API key");
      } else if (status === 429) {
        throw new Error("Rate limit exceeded or quota reached");
      } else if (status === 400) {
        throw new Error(
          `Bad request: ${data.error?.message || JSON.stringify(data)}`
        );
      } else {
        throw new Error(
          `Claude API error (${status}): ${
            data.error?.message || JSON.stringify(data)
          }`
        );
      }
    }

    throw new Error(`Error calling Claude API: ${error.message}`);
  }
}

/**
 * Extract the text content from Claude's response
 *
 * @param {Object} response - Claude API response
 * @returns {string} - Extracted text from the response
 */
function extractContentFromResponse(response) {
  try {
    if (!response || !response.content || !Array.isArray(response.content)) {
      throw new Error("Invalid response structure");
    }

    // Combine all text parts from the response
    return response.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
  } catch (error) {
    throw new Error(`Failed to extract content: ${error.message}`);
  }
}

module.exports = {
  callClaudeApi,
  extractContentFromResponse,
};
