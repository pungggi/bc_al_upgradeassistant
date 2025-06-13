const { getObjectDefinition } = require("../al-parser-lib/alparser.js");

/**
 * AL Layout Parsing Utilities
 */

/**
 * Removes quotes from a string if it's quoted and unescapes AL path characters.
 * @param {string} str The string to unquote.
 * @returns {string} The unquoted and unescaped string.
 */
function unquotePath(str) {
  if (!str) return "";

  let result = str;

  // Remove quotes if present
  if (
    (result.startsWith("'") && result.endsWith("'")) ||
    (result.startsWith('"') && result.endsWith('"'))
  ) {
    result = result.substring(1, result.length - 1);
  }

  // Unescape AL path characters (backslashes are escaped in AL strings)
  result = result.replace(/\\_/g, "_"); // \_  becomes _
  result = result.replace(/\\\\/g, "\\"); // \\ becomes \

  return result;
}

/**
 * Extracts layout file paths from a 'report' object in AL.
 * Looks for RDLCLayout, WordLayout, and ExcelLayout properties,
 * as well as rendering blocks with layout definitions.
 * @param {string} documentText The full text of the AL file.
 * @returns {{ label: string, path: string }[]} An array of layout objects.
 */
function extractReportLayouts(documentText) {
  const alObject = getObjectDefinition(documentText);
  if (!alObject || alObject.Type !== "Report") {
    return [];
  }

  // Note: getObjectDefinition from al-parser-lib is used for initial object type confirmation.
  // The actual layout properties below are extracted using regular expressions.
  //
  // TODO: Future Enhancement with al-parser-lib
  // The following regex-based parsing is a fallback.
  // If al-parser-lib is enhanced to provide detailed property extraction,
  // replace this section. For example, if a function like
  // `alParser.getReportProperties(documentText)` becomes available
  // that returns an object/map of all properties, it should be used here
  // to directly access 'RDLCLayout', 'WordLayout', 'ExcelLayout', etc.

  const layouts = [];

  // First, try to find direct layout properties (older syntax)
  const layoutProperties = [
    { name: "RDLCLayout", label: "RDLC Layout" },
    { name: "WordLayout", label: "Word Layout" },
    { name: "ExcelLayout", label: "Excel Layout" },
  ];

  for (const prop of layoutProperties) {
    // Regex to find RDLCLayout = 'path/to/file.rdl'; (and variations)
    // It captures the path inside single or double quotes.
    // It allows for spaces around '='.
    // It assumes the property and its value are on a single line.
    const regex = new RegExp(
      `^\\s*${prop.name}\\s*=\\s*['"]([^'"]+)['"]\\s*;`,
      "im"
    );
    const match = documentText.match(regex);

    if (match && match[1]) {
      layouts.push({
        label: prop.label,
        path: unquotePath(match[1].trim()),
      });
    }
  }

  // Second, try to find rendering block layouts (newer syntax)
  // We need to handle nested braces properly, so we'll find the rendering keyword
  // and then manually count braces to find the matching closing brace
  const renderingStartMatch = documentText.match(/rendering\s*\{/i);
  if (renderingStartMatch) {
    const startIndex =
      renderingStartMatch.index + renderingStartMatch[0].length;
    let braceCount = 1;
    let endIndex = startIndex;

    // Find the matching closing brace, accounting for braces in comments and strings
    for (let i = startIndex; i < documentText.length && braceCount > 0; i++) {
      const char = documentText[i];

      // Track line boundaries for comment parsing
      if (char === "\n" || char === "\r") {
        continue;
      }

      // Check for single-line comment
      if (
        char === "/" &&
        i + 1 < documentText.length &&
        documentText[i + 1] === "/"
      ) {
        // Skip to end of line
        while (
          i < documentText.length &&
          documentText[i] !== "\n" &&
          documentText[i] !== "\r"
        ) {
          i++;
        }
        i--; // Adjust for loop increment
        continue;
      }

      // Check for string literals
      if (char === '"' || char === "'") {
        const stringChar = char;
        i++; // Move past opening quote

        // Skip until closing quote, handling escaped quotes
        while (i < documentText.length) {
          if (documentText[i] === stringChar) {
            // Check for escaped quote in AL ('' within single-quoted string)
            if (
              stringChar === "'" &&
              i + 1 < documentText.length &&
              documentText[i + 1] === "'"
            ) {
              i += 2; // Skip both quotes
              continue;
            } else {
              break; // Found closing quote
            }
          }
          i++;
        }
        continue;
      }

      // Count braces only if we're not in a comment or string
      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;
      }
      endIndex = i;
    }

    if (braceCount === 0) {
      const renderingContent = documentText.substring(startIndex, endIndex);

      // Find individual layout blocks within the rendering content using proper brace counting
      // layout('MyLayoutName') { ... } or layout(MyLayoutName) { ... }
      const layoutStartRegex = /layout\s*\(([^)]+)\)\s*\{/gi;
      let layoutMatch;

      while ((layoutMatch = layoutStartRegex.exec(renderingContent)) !== null) {
        const layoutNameInCode = unquotePath(layoutMatch[1].trim());

        // Find the matching closing brace for this layout block using proper brace counting
        const layoutStartIndex = layoutMatch.index + layoutMatch[0].length;
        let layoutBraceCount = 1;
        let layoutEndIndex = layoutStartIndex;

        for (
          let i = layoutStartIndex;
          i < renderingContent.length && layoutBraceCount > 0;
          i++
        ) {
          const char = renderingContent[i];

          // Check for single-line comment
          if (
            char === "/" &&
            i + 1 < renderingContent.length &&
            renderingContent[i + 1] === "/"
          ) {
            // Skip to end of line
            while (
              i < renderingContent.length &&
              renderingContent[i] !== "\n" &&
              renderingContent[i] !== "\r"
            ) {
              i++;
            }
            i--; // Adjust for loop increment
            continue;
          }

          // Check for string literals
          if (char === '"' || char === "'") {
            const stringChar = char;
            i++; // Move past opening quote

            // Skip until closing quote, handling escaped quotes
            while (i < renderingContent.length) {
              if (renderingContent[i] === stringChar) {
                // Check for escaped quote in AL ('' within single-quoted string)
                if (
                  stringChar === "'" &&
                  i + 1 < renderingContent.length &&
                  renderingContent[i + 1] === "'"
                ) {
                  i += 2; // Skip both quotes
                  continue;
                } else {
                  break; // Found closing quote
                }
              }
              i++;
            }
            continue;
          }

          // Count braces only if we're not in a comment or string
          if (char === "{") {
            layoutBraceCount++;
          } else if (char === "}") {
            layoutBraceCount--;
          }
          layoutEndIndex = i;
        }

        if (layoutBraceCount === 0) {
          const layoutBlockContent = renderingContent.substring(
            layoutStartIndex,
            layoutEndIndex
          );

          // Within each layout block, find LayoutFile and optionally Caption.
          const layoutFileRegex = /LayoutFile\s*=\s*['"]([^'"]+)['"]\s*;/i;
          const captionRegex = /Caption\s*=\s*['"]([^'"]+)['"]\s*;/i;

          const fileMatch = layoutBlockContent.match(layoutFileRegex);
          const captionMatch = layoutBlockContent.match(captionRegex);

          if (fileMatch && fileMatch[1]) {
            let label = `Layout: ${layoutNameInCode}`;
            if (captionMatch && captionMatch[1]) {
              label = `${unquotePath(
                captionMatch[1].trim()
              )} (${layoutNameInCode})`;
            }
            layouts.push({
              label: label,
              path: unquotePath(fileMatch[1].trim()),
            });
          }
        }
      }
    }
  }

  return layouts;
}

/**
 * Extracts layout file paths from a 'reportextension' object in AL.
 * Parses the 'rendering' block for layout definitions.
 * @param {string} documentText The full text of the AL file.
 * @returns {{ label: string, path: string }[]} An array of layout objects.
 */
function extractReportExtensionLayouts(documentText) {
  const alObject = getObjectDefinition(documentText);
  if (!alObject || alObject.Type !== "ReportExtension") {
    return [];
  }

  // Note: getObjectDefinition from al-parser-lib is used for initial object type confirmation.
  // The actual rendering layouts below are extracted using proper brace counting.
  //
  // TODO: Future Enhancement with al-parser-lib
  // The following brace-counting parsing is a robust fallback.
  // If al-parser-lib is enhanced to parse the full AL syntax tree,
  // replace this section. For example, if a function like
  // `alParser.getReportExtensionLayouts(documentText)` becomes available
  // that returns a structured representation of the 'rendering' block
  // (e.g., an array of { name, layoutFile, caption } objects),
  // it should be used here.

  const layouts = [];

  // Find the rendering block using proper brace counting to handle indented closing braces
  const renderingStartMatch = documentText.match(/rendering\s*\{/i);
  if (renderingStartMatch) {
    const startIndex =
      renderingStartMatch.index + renderingStartMatch[0].length;
    let braceCount = 1;
    let endIndex = startIndex;

    // Find the matching closing brace, accounting for braces in comments and strings
    for (let i = startIndex; i < documentText.length && braceCount > 0; i++) {
      const char = documentText[i];

      // Track line boundaries for comment parsing
      if (char === "\n" || char === "\r") {
        continue;
      }

      // Check for single-line comment
      if (
        char === "/" &&
        i + 1 < documentText.length &&
        documentText[i + 1] === "/"
      ) {
        // Skip to end of line
        while (
          i < documentText.length &&
          documentText[i] !== "\n" &&
          documentText[i] !== "\r"
        ) {
          i++;
        }
        i--; // Adjust for loop increment
        continue;
      }

      // Check for string literals
      if (char === '"' || char === "'") {
        const stringChar = char;
        i++; // Move past opening quote

        // Skip until closing quote, handling escaped quotes
        while (i < documentText.length) {
          if (documentText[i] === stringChar) {
            // Check for escaped quote in AL ('' within single-quoted string)
            if (
              stringChar === "'" &&
              i + 1 < documentText.length &&
              documentText[i + 1] === "'"
            ) {
              i += 2; // Skip both quotes
              continue;
            } else {
              break; // Found closing quote
            }
          }
          i++;
        }
        continue;
      }

      // Count braces only if we're not in a comment or string
      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;
      }
      endIndex = i;
    }

    if (braceCount === 0) {
      const renderingContent = documentText.substring(startIndex, endIndex);

      // Find individual layout blocks within the rendering content using proper brace counting
      // layout('MyLayoutName') { ... } or layout(MyLayoutName) { ... }
      const layoutStartRegex = /layout\s*\(([^)]+)\)\s*\{/gi;
      let layoutMatch;

      while ((layoutMatch = layoutStartRegex.exec(renderingContent)) !== null) {
        const layoutNameInCode = unquotePath(layoutMatch[1].trim());

        // Find the matching closing brace for this layout block using proper brace counting
        const layoutStartIndex = layoutMatch.index + layoutMatch[0].length;
        let layoutBraceCount = 1;
        let layoutEndIndex = layoutStartIndex;

        for (
          let i = layoutStartIndex;
          i < renderingContent.length && layoutBraceCount > 0;
          i++
        ) {
          const char = renderingContent[i];

          // Check for single-line comment
          if (
            char === "/" &&
            i + 1 < renderingContent.length &&
            renderingContent[i + 1] === "/"
          ) {
            // Skip to end of line
            while (
              i < renderingContent.length &&
              renderingContent[i] !== "\n" &&
              renderingContent[i] !== "\r"
            ) {
              i++;
            }
            i--; // Adjust for loop increment
            continue;
          }

          // Check for string literals
          if (char === '"' || char === "'") {
            const stringChar = char;
            i++; // Move past opening quote

            // Skip until closing quote, handling escaped quotes
            while (i < renderingContent.length) {
              if (renderingContent[i] === stringChar) {
                // Check for escaped quote in AL ('' within single-quoted string)
                if (
                  stringChar === "'" &&
                  i + 1 < renderingContent.length &&
                  renderingContent[i + 1] === "'"
                ) {
                  i += 2; // Skip both quotes
                  continue;
                } else {
                  break; // Found closing quote
                }
              }
              i++;
            }
            continue;
          }

          // Count braces only if we're not in a comment or string
          if (char === "{") {
            layoutBraceCount++;
          } else if (char === "}") {
            layoutBraceCount--;
          }
          layoutEndIndex = i;
        }

        if (layoutBraceCount === 0) {
          const layoutBlockContent = renderingContent.substring(
            layoutStartIndex,
            layoutEndIndex
          );

          // Within each layout block, find LayoutFile and optionally Caption.
          const layoutFileRegex = /LayoutFile\s*=\s*['"]([^'"]+)['"]\s*;/i;
          const captionRegex = /Caption\s*=\s*['"]([^'"]+)['"]\s*;/i;

          const fileMatch = layoutBlockContent.match(layoutFileRegex);
          const captionMatch = layoutBlockContent.match(captionRegex);

          if (fileMatch && fileMatch[1]) {
            let label = `Layout: ${layoutNameInCode}`;
            if (captionMatch && captionMatch[1]) {
              label = `${unquotePath(
                captionMatch[1].trim()
              )} (${layoutNameInCode})`;
            }
            layouts.push({
              label: label,
              path: unquotePath(fileMatch[1].trim()),
            });
          }
        }
      }
    }
  }
  return layouts;
}

module.exports = {
  extractReportLayouts,
  extractReportExtensionLayouts,
};
