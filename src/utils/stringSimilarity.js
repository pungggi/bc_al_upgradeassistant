const { distance } = require("fastest-levenshtein");

/**
 * Find the most similar field names to the given field
 * @param {string} invalidField - The invalid field name
 * @param {string[]} validFields - Array of valid field names
 * @param {number} limit - Max number of suggestions to return
 * @returns {string[]} - Array of suggested field names
 */
function findSimilarFieldNames(invalidField, validFields, limit = 3) {
  if (!invalidField || !validFields || validFields.length === 0) {
    return [];
  }

  const lowerInvalidField = invalidField.toLowerCase();

  // Calculate similarity for each valid field
  const similarities = validFields.map((field) => {
    const lowerField = field.toLowerCase();
    return {
      field,
      // Calculate normalized distance (lower is better)
      distance: distance(lowerInvalidField, lowerField),
      // Bonus for prefix match
      prefixBonus: lowerField.startsWith(lowerInvalidField.substring(0, 2))
        ? 1
        : 0,
    };
  });

  // Sort by distance (lowest first) and then by prefix bonus (highest first)
  similarities.sort((a, b) => {
    if (a.prefixBonus !== b.prefixBonus) {
      return b.prefixBonus - a.prefixBonus;
    }
    return a.distance - b.distance;
  });

  // Return top matches
  return similarities.slice(0, limit).map((item) => item.field);
}

module.exports = {
  findSimilarFieldNames,
};
