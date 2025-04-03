# Plan: Refactor String Similarity Scoring

**Goal:** Modify the string similarity logic in `src/utils/stringSimilarity.js` to use a weighted average scoring formula, aiming to improve the relevance of the top 3 suggestions.

**Diagram:**

```mermaid
graph TD
    A[Plan Approved: Weighted Average Score] --> B{Modify Score Calculation};
    B --> C{Normalize Scores};
    C --> D{Calculate Weighted Average Score};
    D --> E{Reverse Sort Order (Descending)};
    E --> F{Remove Threshold Filtering Logic};
    F --> G{Adjust Suggestion Count Logic};
    G --> H{Update Console Logging};
    H --> I[Final Plan Ready];
```

**Detailed Steps:**

1.  **Modify Score Calculation (within `map` on lines 20-57):**

    - Calculate existing `levenScore`, `containsScore`, `wordMatchScore`, `prefixScore`.
    - Calculate normalized scores (0-1 range, higher is better for components):
      - `normLeven = levenScore / Math.max(lowerInvalidField.length, lowerField.length || 1)`
      - `normContains = containsScore / 3`
      - `normWordMatch = wordMatchScore / (invalidWords.length || 1)`
      - `normPrefix = prefixScore / 2`
    - Calculate the new `finalScore` using the weighted average (higher score is better):
      - `finalScore = (0.5 * (1 - normLeven)) + (0.2 * normContains) + (0.2 * normWordMatch) + (0.1 * normPrefix)`
    - Update the returned object to use this new `finalScore` and include normalized components for potential debugging/logging.

2.  **Reverse Sort Order (line 60):**

    - Change `similarities.sort((a, b) => a.score - b.score);`
    - To `similarities.sort((a, b) => b.score - a.score);` (Sort descending by score).

3.  **Remove Threshold Filtering (lines 62-69):**

    - Delete or comment out the lines calculating `bestScore`, `reasonableThreshold`, and filtering `reasonableMatches`.

4.  **Adjust Suggestion Count Logic (lines 70-71):**

    - Replace the existing `minMatches` and `numToTake` calculation with:
      - `const minRequired = Math.max(limit, 3);`
      - `const numToTake = Math.min(minRequired, similarities.length);`

5.  **Update Console Logging (lines 73-83):**
    - Adjust the `console.log` to reflect the new scoring system (higher is better) and remove references to the threshold-based filtering.
