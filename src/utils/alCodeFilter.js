const { getIdRanges, isIdInRanges } = require("./appJsonReader");

/**
 * Filter AL code to include only fields within ID ranges from app.json
 * @param {string} alCode - AL code to filter
 * @returns {string} Filtered AL code
 */
function filterToIdRanges(alCode) {
  const idRanges = getIdRanges();

  // If no ID ranges found, return original code
  if (!idRanges || idRanges.length === 0) {
    console.log("No ID ranges found, returning original code");
    return alCode;
  }

  // Detect if this is a table or page
  const objectMatch = alCode.match(
    /\b(table|page|tableextension|pageextension)\b\s+(\d+)\s+["']([^"']+)["']/i
  );
  if (!objectMatch) {
    console.log("Not a table or page object, returning original code");
    return alCode; // Not a table or page, return as is
  }

  const objectType = objectMatch[1].toLowerCase();

  // For tables and pages, filter fields based on their IDs
  if (objectType.includes("table") || objectType.includes("page")) {
    // Split code into lines for processing
    const lines = alCode.split("\n");
    const outputLines = [];

    let inFieldsBlock = false;
    let openBraces = 0;
    let skipCurrentField = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Track braces to understand block structure
      const openBracesInLine = (trimmedLine.match(/{/g) || []).length;
      const closeBracesInLine = (trimmedLine.match(/}/g) || []).length;
      openBraces += openBracesInLine - closeBracesInLine;

      // Detect entry into fields section
      if (
        !inFieldsBlock &&
        /\bfields\b/i.test(trimmedLine) &&
        trimmedLine.includes("{")
      ) {
        inFieldsBlock = true;
      }

      // If in fields block, check each field
      if (inFieldsBlock) {
        // Match field ID pattern: field(ID; Name)
        const fieldMatch = trimmedLine.match(/\bfield\b\s*\((\d+)\s*;/i);

        if (fieldMatch && !skipCurrentField) {
          const fieldId = parseInt(fieldMatch[1], 10);

          // Check if field ID is within ranges
          if (!isIdInRanges(fieldId, idRanges)) {
            skipCurrentField = true;
            continue; // Skip this line
          }
        }

        // If we're skipping a field and hit a semicolon at the end of a line,
        // we're likely at the end of the field definition
        if (skipCurrentField && /;\s*$/.test(trimmedLine)) {
          skipCurrentField = false;
          continue;
        }
      }

      // Exit fields section
      if (inFieldsBlock && openBraces === 0) {
        inFieldsBlock = false;
      }

      // Add line to output if we're not skipping it
      if (!skipCurrentField) {
        outputLines.push(line);
      }
    }

    return outputLines.join("\n");
  }

  // For other object types, return original code
  return alCode;
}

module.exports = {
  filterToIdRanges,
};
