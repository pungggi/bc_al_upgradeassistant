const fs = require("fs");

/**
 * Safely read and parse JSON file with fallback handling for corrupt files
 * @param {string} filePath - Path to JSON file
 * @returns {object|null} Parsed JSON or null if parsing failed
 */
function readJsonFile(filePath) {
  if (!filePath) {
    console.error("No file path provided for reading JSON");
    return null;
  }

  try {
    const text = fs.readFileSync(filePath, "utf8");
    if (!text) return null;

    return JSON.parse(text);
  } catch (parseError) {
    console.warn(
      `Initial JSON parsing failed for ${filePath}: ${parseError.message}`
    );

    try {
      const text = fs.readFileSync(filePath, "utf8");

      // Handle "Unexpected non-whitespace character after JSON" error
      if (parseError.message.includes("non-whitespace character after JSON")) {
        // Find the position from the error message
        const match = parseError.message.match(/position (\d+)/);
        if (match && match[1]) {
          const position = parseInt(match[1]);
          // Truncate up to the position where the error occurred
          const truncated = text.substring(0, position);
          return JSON.parse(truncated);
        }
      }

      // Try to find the last valid closing bracket
      let lastBracketIndex = text.lastIndexOf("}");
      if (lastBracketIndex > 0) {
        // Attempt parse with truncated string
        const truncated = text.substring(0, lastBracketIndex + 1);
        return JSON.parse(truncated);
      }

      // Still failed - try to clean the string of non-JSON characters
      const cleaned = text.replace(/[^\x20-\x7E]/g, "");
      return JSON.parse(cleaned);
    } catch (recoveryError) {
      console.error(
        `Failed to recover JSON from ${filePath}: ${recoveryError.message}`
      );
      return null;
    }
  }
}

/**
 * Import the safeParseJson functionality from jsonSafeParser into this file
 * @param {string} text - JSON text to parse
 * @param {string} filePath - Path to file (for logging)
 * @returns {object|null} Parsed JSON or null if parsing failed
 */
function safeParseJson(text, filePath) {
  if (!text || typeof text !== "string") {
    console.error(`Invalid text input for JSON parsing from ${filePath}`);
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn(`Initial JSON parsing failed: ${error.message}`);

    // Handle "Unexpected non-whitespace character after JSON" error
    if (error.message.includes("non-whitespace character after JSON")) {
      const match = error.message.match(/position (\d+)/);
      if (match && match[1]) {
        const position = parseInt(match[1]);
        try {
          // Truncate up to the position where the error occurred
          const truncated = text.substring(0, position);
          return JSON.parse(truncated);
        } catch (truncateError) {
          console.error(
            `Failed to parse truncated JSON at position ${position}: ${truncateError.message}`
          );
        }
      }
    }

    try {
      // Try to find the last valid closing bracket
      let lastBracketIndex = text.lastIndexOf("}");
      if (lastBracketIndex > 0) {
        // Attempt parse with truncated string
        const truncated = text.substring(0, lastBracketIndex + 1);
        return JSON.parse(truncated);
      }
    } catch (truncateError) {
      console.error(
        `Failed to recover JSON by finding closing bracket: ${truncateError.message}`
      );
    }

    // Still failed - try to clean the string of non-JSON characters
    try {
      const cleaned = text.replace(/[^\x20-\x7E]/g, "");
      return JSON.parse(cleaned);
    } catch (cleanError) {
      console.error(`Failed to clean and parse JSON: ${cleanError.message}`);
    }

    return null;
  }
}

module.exports = {
  readJsonFile,
  safeParseJson,
};
