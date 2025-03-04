const fs = require("fs");

/**
 * Safely parse JSON with detailed error handling
 * @param {string} jsonString - JSON string to parse
 * @param {string} source - Source description for error reporting
 * @returns {Object} - Parsed JSON object
 */
function safeJsonParse(jsonString, source = "unknown") {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    const lineNumber = getJsonErrorLineNumber(error, jsonString);
    const contextLines = getContextLines(jsonString, lineNumber, 3);

    console.error(`JSON parse error in ${source}:`);
    console.error(`Error: ${error.message}`);
    console.error(`Near line ${lineNumber}:`);
    console.error(contextLines);

    throw new Error(
      `Invalid JSON in ${source}: ${error.message} near line ${lineNumber}`
    );
  }
}

/**
 * Safely read and parse a JSON file
 * @param {string} filePath - Path to JSON file
 * @returns {Object} - Parsed JSON object
 */
function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return safeJsonParse(content, filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`JSON file not found: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Get the line number from a JSON parse error
 * @param {Error} error - JSON parse error
 * @param {string} jsonString - Original JSON string
 * @returns {number} - Line number
 */
function getJsonErrorLineNumber(error, jsonString) {
  const match = /position (\d+)/.exec(error.message);
  if (match) {
    const position = parseInt(match[1], 10);
    // Count newlines up to this position
    const upToPosition = jsonString.substring(0, position);
    return (upToPosition.match(/\n/g) || []).length + 1;
  }
  return 0;
}

/**
 * Get context lines around a specific line
 * @param {string} text - Full text
 * @param {number} lineNumber - Target line number
 * @param {number} context - Number of context lines
 * @returns {string} - Context lines with line numbers
 */
function getContextLines(text, lineNumber, context) {
  const lines = text.split("\n");
  const start = Math.max(0, lineNumber - context - 1);
  const end = Math.min(lines.length, lineNumber + context);

  return lines
    .slice(start, end)
    .map((line, i) => `${start + i + 1}: ${line}`)
    .join("\n");
}

module.exports = {
  safeJsonParse,
  readJsonFile,
};
