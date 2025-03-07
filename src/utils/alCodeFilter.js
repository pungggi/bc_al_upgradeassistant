const calParser = require("./calParser");

/**
 * Extract ID ranges from app.json
 * @returns {Array<{from: number, to: number}>} Array of ID range objects
 */
function getIdRangesFromAppJson() {
  return calParser.getIdRangesFromAppJson();
}

/**
 * Check if an ID is within any of the allowed ID ranges
 * @param {number} id - The ID to check
 * @param {Array<{from: number, to: number}>} idRanges - Array of ID range objects
 * @returns {boolean} - Whether the ID is within any range
 */
function isIdInRanges(id, idRanges) {
  return calParser.isIdInRanges(id, idRanges);
}

/**
 * Filter AL code to include only fields and controls within ID ranges
 * @param {string} code - The AL code to filter
 * @param {boolean} returnDebugInfo - Whether to return additional debug information
 * @returns {Object|string} - Filtered AL code or object with debug info
 */
function filterToIdRanges(code, returnDebugInfo = false) {
  const idRanges = getIdRangesFromAppJson();

  if (idRanges.length === 0) {
    console.log("No ID ranges found, returning original code");
    return returnDebugInfo ? { filteredCode: code } : code;
  }

  console.log(`Found ${idRanges.length} ID ranges in app.json:`, idRanges);

  // Detect if the code is C/AL (contains OBJECT) or AL syntax
  const isCAL = code.includes("OBJECT ") || code.includes("OBJECT-PROPERTIES");

  if (isCAL) {
    // Process C/AL code using our new parser
    return calParser.filterCALToIdRanges(code, returnDebugInfo);
  } else {
    // Process modern AL code
    const filteredCode = filterTableFields(code, idRanges);
    const finalCode = filterPageControls(filteredCode, idRanges);
    return returnDebugInfo ? { filteredCode: finalCode } : finalCode;
  }
}

/**
 * Filter table fields based on ID ranges
 * @param {string} code - The AL code to filter
 * @param {Array<{from: number, to: number}>} idRanges - Array of ID range objects
 * @returns {string} - Filtered AL code
 */
function filterTableFields(code, idRanges) {
  // Regular expression to match table field declarations
  const fieldRegex =
    /field\s*\(\s*(\d+)\s*;[^;{}]*\)\s*{[^{}]*(?:{[^{}]*}[^{}]*)*}/g;

  // Replace fields outside of ID ranges with comments
  return code.replace(fieldRegex, (match, id) => {
    if (isIdInRanges(id, idRanges)) {
      return match; // Keep fields within ranges
    } else {
      return `// Field with ID ${id} removed as it's outside app.json ID ranges\n`;
    }
  });
}

/**
 * Filter page controls based on ID ranges
 * @param {string} code - The AL code to filter
 * @param {Array<{from: number, to: number}>} idRanges - Array of ID range objects
 * @returns {string} - Filtered AL code
 */
function filterPageControls(code, idRanges) {
  // Regular expression to match page control declarations with IDs
  // This handles different control types (field, part, group, etc.)
  const controlRegex =
    /(\s*)(field|part|group|systempart|chartpart|cuegroup)\s*\(\s*(\d+)\s*;[^;{}]*\)\s*{[^{}]*(?:{[^{}]*}[^{}]*)*}/g;

  // Replace controls outside of ID ranges with comments
  return code.replace(controlRegex, (match, indent, type, id) => {
    if (isIdInRanges(id, idRanges)) {
      return match; // Keep controls within ranges
    } else {
      return `${indent}// ${type} with ID ${id} removed as it's outside app.json ID ranges\n`;
    }
  });
}

module.exports = {
  filterToIdRanges,
  getIdRangesFromAppJson,
  isIdInRanges,
};
