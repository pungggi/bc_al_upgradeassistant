const { distance } = require("fastest-levenshtein");
const { logger } = require("./logger");

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

  // Log the input for debugging
  logger.info(
    `[StringSimilarity] Finding similar names for '${invalidField}' among ${validFields.length} fields`
  );

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

    // Improved word matching - count how many words from the invalid field
    // are found in the valid field (partial or exact matches)
    const wordMatchScore = invalidWords.reduce((score, word) => {
      // Check for exact word match (higher score)
      if (fieldWords.some((fieldWord) => fieldWord === word)) {
        return score + 2;
      }
      // Check for partial word match (lower score)
      else if (
        fieldWords.some(
          (fieldWord) => fieldWord.includes(word) || word.includes(fieldWord)
        )
      ) {
        return score + 1;
      }
      return score;
    }, 0);

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
    // Apply a more aggressive length penalty for better matching
    const lengthPenalty = Math.min(
      0.7, // Increased from 0.5 to 0.7 to penalize longer suggestions more
      lengthDiff / (lowerInvalidField.length * 1.5) // Reduced divisor from 2 to 1.5
    );

    // Calculate Levenshtein distance
    const levenScore = distance(lowerInvalidField, lowerField);

    // Normalize scores to 0-1 range (higher is better)
    const normLeven =
      1 -
      levenScore / Math.max(lowerInvalidField.length, lowerField.length || 1);
    const normContains = containsScore / 3;

    // Normalize word match score - divide by maximum possible score (2 points per word)
    const maxWordScore = invalidWords.length * 2;
    const normWordMatch = wordMatchScore / (maxWordScore || 1);

    const normExactWordMatch = exactWordMatchBonus / 2;

    // Normalize length penalty (0-1 range, lower is better)
    // Cap the penalty at 0.7 to increase penalties for much longer suggestions
    const normLengthPenalty = Math.min(0.7, lengthPenalty);

    // Calculate weighted average (weights sum to 1.0)
    const finalScore =
      0.4 * normLeven + // Levenshtein similarity (40% weight, increased from 35%)
      0.15 * normContains + // Contains score (15% weight)
      0.15 * normWordMatch + // Word match score (15% weight, decreased from 30%)
      0.2 * normExactWordMatch - // Exact word match bonus (20% weight)
      0.2 * normLengthPenalty; // Length penalty (20% weight, increased from 10%, subtracted)

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

  // Log the similarity scores for debugging
  logger.info(
    `[StringSimilarity] Top ${numToTake} similarity scores for '${invalidField}':`
  );

  const topScores = similarities.slice(0, numToTake).map((s) => ({
    field: s.field,
    score: s.score.toFixed(3),
    leven: s.normLeven.toFixed(3),
    contains: s.normContains.toFixed(3),
    words: s.normWordMatch.toFixed(3),
    exactMatch: s.normExactWordMatch.toFixed(3),
    lengthPenalty: s.normLengthPenalty.toFixed(3),
  }));

  // Log each suggestion separately for better readability
  topScores.forEach((score, index) => {
    logger.info(
      `[StringSimilarity] #${index + 1}: ${score.field} (score: ${
        score.score
      }, ` +
        `leven: ${score.leven}, contains: ${score.contains}, words: ${score.words}, ` +
        `exactMatch: ${score.exactMatch}, lengthPenalty: ${score.lengthPenalty})`
    );
  });

  return similarities.slice(0, numToTake).map((item) => item.field);
}

module.exports = {
  findSimilarNames,
};
