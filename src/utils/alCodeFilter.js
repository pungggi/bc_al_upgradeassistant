const calParser = require("./calParser");
const alParser = require("../../al-parser-lib/alparser");

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

  if (alParser.isCAL(code)) {
    // Process C/AL code using our new parser
    return calParser.filterCALToIdRanges(code, returnDebugInfo);
  } else {
    // Process modern AL code
    // Pass the isIdInRanges function to the new parser functions
    const filteredCode = alParser.filterTableFields(
      code,
      idRanges,
      isIdInRanges
    );
    const finalCode = alParser.filterPageControls(
      filteredCode,
      idRanges,
      isIdInRanges
    );
    return returnDebugInfo ? { filteredCode: finalCode } : finalCode;
  }
}

// Removed filterTableFields and filterPageControls functions as they are now in alparser.js

module.exports = {
  filterToIdRanges,
  getIdRangesFromAppJson,
  isIdInRanges,
};
