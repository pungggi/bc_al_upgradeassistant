const { distance } = require("fastest-levenshtein");

/**
 * Find the most similar field names to the given field
 * @param {string} invalidField - The invalid field name
 * @param {string[]} validFields - Array of valid field names
 * @param {number} limit - Max number of suggestions to return
 * @returns {string[]} - Array of suggested field names
 */
function findSimilarNames(invalidField, validFields, limit = 3) {
  if (!invalidField || !validFields || validFields.length === 0) {
    return [];
  }

  // Normalize the invalid field name
  const lowerInvalidField = invalidField.toLowerCase();
  const invalidWords = lowerInvalidField.split(/[\s-_]+/);

  // Calculate similarity for each valid field
  const similarities = validFields.map((field) => {
    const lowerField = field.toLowerCase();
    const fieldWords = lowerField.split(/[\s-_]+/);

    // Calculate various matching factors
    const containsScore = lowerField.includes(lowerInvalidField)
      ? 3
      : invalidWords.some((word) => lowerField.includes(word))
      ? 2
      : 0;

    const wordMatchScore = invalidWords.reduce(
      (score, word) =>
        score +
        (fieldWords.some((fieldWord) => fieldWord.includes(word)) ? 1 : 0),
      0
    );

    const prefixScore = lowerField.startsWith(lowerInvalidField.substring(0, 2))
      ? 2
      : 0;

    // Calculate Levenshtein distance
    const levenScore = distance(lowerInvalidField, lowerField);

    // Normalize scores to 0-1 range (higher is better)
    const normLeven =
      1 -
      levenScore / Math.max(lowerInvalidField.length, lowerField.length || 1);
    const normContains = containsScore / 3;
    const normWordMatch = wordMatchScore / (invalidWords.length || 1);
    const normPrefix = prefixScore / 2;

    // Calculate weighted average (weights sum to 1.0)
    const finalScore =
      0.59 * normLeven + // Levenshtein similarity (50% weight)
      0.2 * normContains + // Contains score (20% weight)
      0.2 * normWordMatch + // Word match score (20% weight)
      0.01 * normPrefix; // Prefix score (10% weight)

    return {
      field,
      score: finalScore,
      normLeven,
      normContains,
      normWordMatch,
      normPrefix,
      levenScore,
    };
  });

  // Sort by final score (higher is better)
  similarities.sort((a, b) => b.score - a.score);

  // Get the minimum required number of suggestions
  const minRequired = Math.max(limit, 3);
  const numToTake = Math.min(minRequired, similarities.length);
  console.log(
    "Similarity scores:",
    similarities.slice(0, numToTake).map((s) => ({
      field: s.field,
      score: s.score.toFixed(3),
      leven: s.normLeven.toFixed(3),
      contains: s.normContains.toFixed(3),
      words: s.normWordMatch.toFixed(3),
      prefix: s.normPrefix.toFixed(3),
    }))
  );

  return similarities.slice(0, numToTake).map((item) => item.field);
}

module.exports = {
  findSimilarNames,
};
