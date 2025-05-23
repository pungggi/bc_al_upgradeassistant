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

    // Find the matching closing brace
    for (let i = startIndex; i < documentText.length && braceCount > 0; i++) {
      if (documentText[i] === "{") {
        braceCount++;
      } else if (documentText[i] === "}") {
        braceCount--;
      }
      endIndex = i;
    }

    if (braceCount === 0) {
      const renderingContent = documentText.substring(startIndex, endIndex);

      // Regex to find individual layout blocks within the rendering content.
      // layout('MyLayoutName') { ... } or layout(MyLayoutName) { ... }
      // Captures layout name and the content of the layout block.
      const layoutBlockRegex = /layout\s*\(([^)]+)\)\s*\{([\s\S]*?)\}/gi;
      let layoutMatch;

      while ((layoutMatch = layoutBlockRegex.exec(renderingContent)) !== null) {
        const layoutNameInCode = unquotePath(layoutMatch[1].trim());
        const layoutBlockContent = layoutMatch[2];

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
  // The actual rendering layouts below are extracted using regular expressions.
  //
  // TODO: Future Enhancement with al-parser-lib
  // The following regex-based parsing is a fallback.
  // If al-parser-lib is enhanced to parse the full AL syntax tree,
  // replace this section. For example, if a function like
  // `alParser.getReportExtensionLayouts(documentText)` becomes available
  // that returns a structured representation of the 'rendering' block
  // (e.g., an array of { name, layoutFile, caption } objects),
  // it should be used here.

  const layouts = [];
  // First, try to find the 'rendering' block.
  // This regex captures the content inside the rendering { ... } block.
  const renderingBlockRegex = /rendering\s*\{([\s\S]*?)\}/i;
  const renderingBlockMatch = documentText.match(renderingBlockRegex);

  if (renderingBlockMatch && renderingBlockMatch[1]) {
    const renderingContent = renderingBlockMatch[1];

    // Regex to find individual layout blocks within the rendering content.
    // layout('MyLayoutName') { ... }
    // Captures layout name and the content of the layout block.
    const layoutBlockRegex = /layout\s*\(([^)]+)\)\s*\{([\s\S]*?)\}/gi;
    let layoutMatch;

    while ((layoutMatch = layoutBlockRegex.exec(renderingContent)) !== null) {
      const layoutNameInCode = unquotePath(layoutMatch[1].trim());
      const layoutBlockContent = layoutMatch[2];

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
  return layouts;
}

module.exports = {
  extractReportLayouts,
  extractReportExtensionLayouts,
};
