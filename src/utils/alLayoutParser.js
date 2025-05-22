/**
 * AL Layout Parsing Utilities
 */

/**
 * Removes single or double quotes from the start and end of a string.
 * @param {string} str The string to unquote.
 * @returns {string} The unquoted string.
 */
function unquotePath(str) {
  if (!str) return "";
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
    return str.substring(1, str.length - 1);
  }
  return str;
}

/**
 * Extracts layout file paths from a 'report' object in AL.
 * Looks for RDLCLayout, WordLayout, and ExcelLayout properties.
 * @param {string} documentText The full text of the AL file.
 * @returns {{ label: string, path: string }[]} An array of layout objects.
 */
function extractReportLayouts(documentText) {
  const layouts = [];
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
    const regex = new RegExp(`^\\s*${prop.name}\\s*=\\s*['"]([^'"]+)['"]\\s*;`, "im");
    const match = documentText.match(regex);

    if (match && match[1]) {
      layouts.push({
        label: prop.label,
        path: unquotePath(match[1].trim()),
      });
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
          label = `${unquotePath(captionMatch[1].trim())} (${layoutNameInCode})`;
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
