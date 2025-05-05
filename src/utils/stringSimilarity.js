const { distance } = require("fastest-levenshtein");

/**
 * Find the most similar field names to the given field
 * @param {string} invalidField - The invalid field name
 * @param {string[]} validFields - Array of valid field names
 * @param {number} limit - Max number of suggestions to return (default: 4)
 * @returns {string[]} - Array of suggested field names
 */
function findSimilarNames(invalidField, validFields, limit = 4) {
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

    // Calculate exact word match bonus - when all words in the invalid field appear as exact words in the valid field
    const exactWordMatchBonus = invalidWords.every((word) =>
      fieldWords.some((fieldWord) => fieldWord === word)
    )
      ? 2
      : 0;

    // Calculate length penalty - penalize suggestions that are much longer than the original term
    const lengthDiff = Math.max(
      0,
      lowerField.length - lowerInvalidField.length
    );
    // Apply a more aggressive length penalty by squaring the ratio
    const lengthPenalty = Math.pow(lengthDiff / lowerInvalidField.length, 2);

    // Calculate Levenshtein distance
    const levenScore = distance(lowerInvalidField, lowerField);

    // Normalize scores to 0-1 range (higher is better)
    const normLeven =
      1 -
      levenScore / Math.max(lowerInvalidField.length, lowerField.length || 1);
    const normContains = containsScore / 3;
    const normWordMatch = wordMatchScore / (invalidWords.length || 1);
    const normExactWordMatch = exactWordMatchBonus / 2;

    // Normalize length penalty (0-1 range, lower is better)
    // Cap the penalty at 1.0 to avoid extreme penalties
    const normLengthPenalty = Math.min(1, lengthPenalty);

    // Calculate weighted average (weights sum to 1.0)
    const finalScore =
      0.4 * normLeven + // Levenshtein similarity (40% weight)
      0.15 * normContains + // Contains score (15% weight)
      0.15 * normWordMatch + // Word match score (15% weight)
      0.2 * normExactWordMatch - // Exact word match bonus (20% weight)
      0.2 * normLengthPenalty; // Length penalty (20% weight, subtracted)

    return {
      field,
      score: finalScore,
      normLeven,
      normContains,
      normWordMatch,
      normExactWordMatch,
      normLengthPenalty,
      levenScore,
    };
  });

  // Sort by final score (higher is better)
  similarities.sort((a, b) => b.score - a.score);

  // Get the minimum required number of suggestions
  const minRequired = Math.max(limit, 4);
  const numToTake = Math.min(minRequired, similarities.length);
  console.log(
    "Similarity scores:",
    similarities.slice(0, numToTake).map((s) => ({
      field: s.field,
      score: s.score.toFixed(3),
      leven: s.normLeven.toFixed(3),
      contains: s.normContains.toFixed(3),
      words: s.normWordMatch.toFixed(3),
      exactMatch: s.normExactWordMatch.toFixed(3),
      lengthPenalty: s.normLengthPenalty.toFixed(3),
    }))
  );

  return similarities.slice(0, numToTake).map((item) => item.field);
}

module.exports = {
  findSimilarNames,
};
