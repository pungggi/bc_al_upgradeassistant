const vscode = require("vscode");
const { logger } = require("../utils/logger");

/**
 * Extract layout properties information from AL code
 * @param {vscode.TextDocument} document - The document
 * @param {vscode.Range} range - The range to analyze
 * @returns {Object|null} - Object with layout properties info, or null
 */
function extractLayoutProperties(document, range) {
  if (!document || !range) {
    return null;
  }

  const text = document.getText();
  const lines = text.split("\n");

  // Find all reports and their layout properties
  const allReports = [];

  // First pass: find all reports and their boundaries
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for report or reportextension declaration
    const reportPattern = /^\s*(report|reportextension)\s+(\d+)\s+"([^"]+)"(?:\s+extends\s+"[^"]+")?\s*$/;
    const reportMatch = line.match(reportPattern);

    if (reportMatch) {
      const report = {
        reportType: reportMatch[1], // 'report' or 'reportextension'
        reportId: reportMatch[2],
        reportName: reportMatch[3],
        reportStartLine: i,
        reportEndLine: -1,
        layoutProperties: [],
        baseIndentation: null,
        datasetStartLine: -1,
        datasetEndLine: -1,
        requestpageStartLine: -1,
        requestpageEndLine: -1,
        defaultLayoutProperties: [],
      };

      // Find the matching closing brace
      let braceCount = 0;
      let foundOpenBrace = false;

      for (let j = i; j < lines.length; j++) {
        const currentLine = lines[j];

        // Count braces
        for (const char of currentLine) {
          if (char === "{") {
            braceCount++;
            foundOpenBrace = true;
          } else if (char === "}") {
            braceCount--;
            if (foundOpenBrace && braceCount === 0) {
              report.reportEndLine = j;
              break;
            }
          }
        }

        if (report.reportEndLine !== -1) break;
      }

      if (report.reportEndLine !== -1) {
        report.baseIndentation = getBaseIndentation(
          lines,
          report.reportStartLine
        );

        // Find dataset section and its end
        let datasetKeywordLine = -1;
        for (
          let k = report.reportStartLine + 1;
          k < report.reportEndLine;
          k++
        ) {
          const lineTrimmed = lines[k].trim();
          if (lineTrimmed.startsWith("dataset")) {
            // Ensure it's a declaration, not in a comment or string
            if (/^\s*dataset\s*(?:\{|\/\/\s?.*)?\s*$/.test(lines[k])) {
              datasetKeywordLine = k;
              report.datasetStartLine = k;
              break;
            }
          }
        }

        // Find requestpage section and its end
        let requestpageKeywordLine = -1;
        for (
          let k = report.reportStartLine + 1;
          k < report.reportEndLine;
          k++
        ) {
          const lineTrimmed = lines[k].trim();
          if (lineTrimmed.startsWith("requestpage")) {
            // Ensure it's a declaration, not in a comment or string
            if (/^\s*requestpage\s*(?:\{|\/\/\s?.*)?\s*$/.test(lines[k])) {
              requestpageKeywordLine = k;
              report.requestpageStartLine = k;
              break;
            }
          }
        }

        if (datasetKeywordLine !== -1) {
          let braceCount = 0;
          let foundDatasetOpenBrace = false;
          for (let k = datasetKeywordLine; k < report.reportEndLine; k++) {
            const lineContent = lines[k];
            let inLineComment = false;
            let inString = false;
            let stringChar = "";

            for (
              let charIndex = 0;
              charIndex < lineContent.length;
              charIndex++
            ) {
              const char = lineContent[charIndex];

              if (inLineComment) continue;

              if (
                char === "/" &&
                charIndex + 1 < lineContent.length &&
                lineContent[charIndex + 1] === "/"
              ) {
                inLineComment = true;
                continue;
              }

              if (inString) {
                if (char === stringChar) {
                  // Check for escaped quote: '' within a string in AL
                  if (
                    stringChar === "'" &&
                    charIndex + 1 < lineContent.length &&
                    lineContent[charIndex + 1] === "'"
                  ) {
                    charIndex++; // Skip next quote
                  } else {
                    inString = false;
                  }
                }
                continue;
              } else if (char === "'" || char === '"') {
                inString = true;
                stringChar = char;
                continue;
              }

              if (char === "{") {
                if (k >= datasetKeywordLine) {
                  // Only count braces at or after dataset keyword line
                  braceCount++;
                  foundDatasetOpenBrace = true;
                }
              } else if (char === "}") {
                if (foundDatasetOpenBrace) {
                  braceCount--;
                  if (braceCount === 0) {
                    report.datasetEndLine = k;
                    break;
                  }
                }
              }
            }
            if (
              foundDatasetOpenBrace &&
              braceCount === 0 &&
              report.datasetEndLine !== -1
            ) {
              break;
            }
            if (
              !foundDatasetOpenBrace &&
              k > datasetKeywordLine + 5 &&
              /^\s*(requestpage|actions|rendering|labels|trigger|procedure)\s*(?:\{|\/\/\s?.*)?\s*$/.test(
                lines[k].trim()
              )
            ) {
              report.datasetStartLine = -1; // Invalidate if other block starts before dataset's {
              break;
            }
          }
          if (braceCount !== 0) {
            // Malformed dataset block
            report.datasetStartLine = -1;
            report.datasetEndLine = -1;
          }
        }

        // Find requestpage section end
        if (requestpageKeywordLine !== -1) {
          let braceCount = 0;
          let foundRequestpageOpenBrace = false;
          for (let k = requestpageKeywordLine; k < report.reportEndLine; k++) {
            const lineContent = lines[k];
            let inLineComment = false;
            let inString = false;
            let stringChar = "";

            for (
              let charIndex = 0;
              charIndex < lineContent.length;
              charIndex++
            ) {
              const char = lineContent[charIndex];

              if (inLineComment) continue;

              if (
                char === "/" &&
                charIndex + 1 < lineContent.length &&
                lineContent[charIndex + 1] === "/"
              ) {
                inLineComment = true;
                continue;
              }

              if (inString) {
                if (char === stringChar) {
                  // Check for escaped quote: '' within a string in AL
                  if (
                    stringChar === "'" &&
                    charIndex + 1 < lineContent.length &&
                    lineContent[charIndex + 1] === "'"
                  ) {
                    charIndex++; // Skip next quote
                  } else {
                    inString = false;
                  }
                }
                continue;
              } else if (char === "'" || char === '"') {
                inString = true;
                stringChar = char;
                continue;
              }

              if (char === "{") {
                if (k >= requestpageKeywordLine) {
                  // Only count braces at or after requestpage keyword line
                  braceCount++;
                  foundRequestpageOpenBrace = true;
                }
              } else if (char === "}") {
                if (foundRequestpageOpenBrace) {
                  braceCount--;
                  if (braceCount === 0) {
                    report.requestpageEndLine = k;
                    break;
                  }
                }
              }
            }
            if (
              foundRequestpageOpenBrace &&
              braceCount === 0 &&
              report.requestpageEndLine !== -1
            ) {
              break;
            }
            if (
              !foundRequestpageOpenBrace &&
              k > requestpageKeywordLine + 5 &&
              /^\s*(dataset|rendering|labels|trigger|procedure)\s*(?:\{|\/\/\s?.*)?\s*$/.test(
                lines[k].trim()
              )
            ) {
              report.requestpageStartLine = -1; // Invalidate if other block starts before requestpage's {
              break;
            }
          }
          if (braceCount !== 0) {
            // Malformed requestpage block
            report.requestpageStartLine = -1;
            report.requestpageEndLine = -1;
          }
        }
      }
      allReports.push(report);
    }
  }

  // Second pass: find layout properties within each report
  for (const report of allReports) {
    for (let i = report.reportStartLine; i <= report.reportEndLine; i++) {
      const line = lines[i];

      // Match RDLCLayout property
      const rdlcMatch = line.match(
        /^(\s*)(RDLCLayout)\s*=\s*['"]([^'"]+)['"];?\s*$/
      );
      if (rdlcMatch) {
        report.layoutProperties.push({
          type: "RDLC",
          originalProperty: "RDLCLayout",
          path: rdlcMatch[3],
          lineNumber: i,
          indentation: rdlcMatch[1],
          fullLine: line,
        });
      }

      // Match WordLayout property
      const wordMatch = line.match(
        /^(\s*)(WordLayout)\s*=\s*['"]([^'"]+)['"];?\s*$/
      );
      if (wordMatch) {
        report.layoutProperties.push({
          type: "Word",
          originalProperty: "WordLayout",
          path: wordMatch[3],
          lineNumber: i,
          indentation: wordMatch[1],
          fullLine: line,
        });
      }

      // Match DefaultLayout property (old syntax to be removed)
      const defaultLayoutMatch = line.match(
        /^(\s*)(DefaultLayout)\s*=\s*([^;]*)(;?)\s*$/
      );
      if (defaultLayoutMatch) {
        report.defaultLayoutProperties.push({
          originalProperty: "DefaultLayout",
          value: defaultLayoutMatch[3].trim(),
          lineNumber: i,
          indentation: defaultLayoutMatch[1],
          fullLine: line,
        });
      }
    }
  }

  // Filter reports that have layout properties or DefaultLayout properties
  const reportsWithLayoutProperties = allReports.filter(
    (report) => report.layoutProperties.length > 0 || report.defaultLayoutProperties.length > 0
  );

  if (reportsWithLayoutProperties.length === 0) {
    return null;
  }

  // For now, return the first report with layout properties
  // In the future, we could return all reports or the one that intersects with the range
  const firstReport = reportsWithLayoutProperties[0];

  return {
    reportType: firstReport.reportType,
    reportId: firstReport.reportId,
    reportName: firstReport.reportName,
    reportStartLine: firstReport.reportStartLine,
    reportEndLine: firstReport.reportEndLine,
    layoutProperties: firstReport.layoutProperties,
    defaultLayoutProperties: firstReport.defaultLayoutProperties,
    baseIndentation: firstReport.baseIndentation,
    datasetStartLine: firstReport.datasetStartLine,
    datasetEndLine: firstReport.datasetEndLine,
    requestpageStartLine: firstReport.requestpageStartLine,
    requestpageEndLine: firstReport.requestpageEndLine,
    allReports: reportsWithLayoutProperties, // Include all reports for potential future use
  };
}

/**
 * Get the base indentation for the report object
 * @param {string[]} lines - All lines in the document
 * @param {number} reportStartLine - The line where the report starts
 * @returns {string} - The base indentation string
 */
function getBaseIndentation(lines, reportStartLine) {
  // Look for the opening brace to determine base indentation
  for (
    let i = reportStartLine;
    i < Math.min(reportStartLine + 5, lines.length);
    i++
  ) {
    const line = lines[i];
    if (line.includes("{")) {
      const match = line.match(/^(\s*)/);
      return match ? match[1] + "  " : "  "; // Add 2 spaces for content inside braces
    }
  }
  return "  "; // Default indentation
}

/**
 * Generates the DefaultRenderingLayout property line.
 * @param {Object} layoutInfo - The layout properties information.
 * @returns {string} - The DefaultRenderingLayout property line.
 */
function generateDefaultRenderingLayoutLine(layoutInfo) {
  const { layoutProperties, baseIndentation } = layoutInfo;
  const indent = baseIndentation;

  if (layoutProperties.length > 0) {
    let chosenLayoutNameAsIdentifier = "";
    const rdlcLayout = layoutProperties.find((prop) => prop.type === "RDLC");
    if (rdlcLayout) {
      chosenLayoutNameAsIdentifier = rdlcLayout.originalProperty; // e.g., "RDLCLayout"
    } else {
      // If no RDLC, pick the first available layout property's original name
      chosenLayoutNameAsIdentifier = layoutProperties[0].originalProperty;
    }
    return `${indent}DefaultRenderingLayout = ${chosenLayoutNameAsIdentifier};`;
  }
  return ""; // Should ideally not be reached if action is available
}

/**
 * Generates the rendering block itself (without DefaultRenderingLayout property).
 * @param {Object} layoutInfo - The layout properties information.
 * @returns {string} - The rendering block string.
 */
function generateRenderingBlockItself(layoutInfo) {
  const { layoutProperties, baseIndentation, reportName } = layoutInfo;
  const indent = baseIndentation;
  const layoutIndent = indent + "  ";
  const propertyIndent = layoutIndent + "  ";

  let renderingBlock = `${indent}rendering\n${indent}{\n`;
  layoutProperties.forEach((prop, index) => {
    const layoutName = prop.originalProperty; // Use original property name as layout name
    renderingBlock += `${layoutIndent}layout(${layoutName})\n`;
    renderingBlock += `${layoutIndent}{\n`;
    renderingBlock += `${propertyIndent}Type = ${prop.type};\n`;
    renderingBlock += `${propertyIndent}LayoutFile = '${prop.path}';\n`;
    renderingBlock += `${propertyIndent}Caption = '${reportName}';\n`;
    renderingBlock += `${layoutIndent}}`;
    if (index < layoutProperties.length - 1) {
      renderingBlock += "\n";
    }
  });
  renderingBlock += `\n${indent}}`;
  return renderingBlock;
}

/**
 * Code Action Provider for layout properties transformation
 */
class LayoutPropertiesActionProvider {
  /**
   * Provide code actions for layout properties transformation
   * @param {vscode.TextDocument} document - The document
   * @param {vscode.Range} range - The range
   * @returns {vscode.CodeAction[]} - The code actions
   */
  async provideCodeActions(document, range) {
    // Only process AL files
    if (document.languageId !== "al") {
      return [];
    }

    logger.info("[LayoutProperties] Analyzing document for layout properties");

    // Try to extract layout properties from the current range or document
    const layoutInfo = extractLayoutProperties(document, range);

    if (!layoutInfo) {
      // Try to analyze the entire document if no layout properties found in range
      const fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount - 1, 0)
      );
      const fullLayoutInfo = extractLayoutProperties(document, fullRange);

      if (!fullLayoutInfo) {
        logger.verbose("[LayoutProperties] No layout properties found");
        return [];
      }

      // Use the full document layout info
      Object.assign(layoutInfo, fullLayoutInfo);
    }

    const totalLayoutCount = layoutInfo.layoutProperties.length + layoutInfo.defaultLayoutProperties.length;
    logger.info(
      `[LayoutProperties] Found ${layoutInfo.layoutProperties.length} layout properties and ${layoutInfo.defaultLayoutProperties.length} DefaultLayout properties in report ${layoutInfo.reportId}`
    );

    const actions = [];

    // Create the main transformation action
    const action = new vscode.CodeAction(
      `Transform to new rendering syntax (${
        layoutInfo.layoutProperties.length
      } layout${layoutInfo.layoutProperties.length > 1 ? "s" : ""})`,
      vscode.CodeActionKind.RefactorRewrite
    );

    action.isPreferred = true;

    // Create the edit to replace old layout properties with new rendering block
    const edit = new vscode.WorkspaceEdit();

    // Collect all properties to remove (layout properties + DefaultLayout properties)
    const allPropertiesToRemove = [
      ...layoutInfo.layoutProperties,
      ...layoutInfo.defaultLayoutProperties
    ];

    // Sort all properties by line number (descending) to replace from bottom to top
    const sortedProperties = allPropertiesToRemove.sort(
      (a, b) => b.lineNumber - a.lineNumber
    );

    // Remove old property lines (both layout properties and DefaultLayout)
    for (const prop of sortedProperties) {
      const lineRange = new vscode.Range(
        new vscode.Position(prop.lineNumber, 0),
        new vscode.Position(prop.lineNumber + 1, 0)
      );
      edit.delete(document.uri, lineRange);
    }

    // Only proceed if we have layout properties to convert to rendering syntax
    if (layoutInfo.layoutProperties.length > 0) {
      const firstProperty = layoutInfo.layoutProperties.reduce((first, current) =>
        current.lineNumber < first.lineNumber ? current : first
      );
      const firstPropertyLine = firstProperty.lineNumber;

      const defaultLayoutLineText =
        generateDefaultRenderingLayoutLine(layoutInfo);
      const renderingBlockItselfText = generateRenderingBlockItself(layoutInfo);

      // Insert DefaultRenderingLayout at the original first property's line
      edit.insert(
        document.uri,
        new vscode.Position(firstPropertyLine, 0),
        defaultLayoutLineText + "\n\n" // Add two newlines for spacing before rendering block or next content
      );

      let renderingBlockActualInsertLine;

      // Determine where to place the rendering block based on requestpage and dataset sections
      if (
        layoutInfo.requestpageEndLine !== undefined &&
        layoutInfo.requestpageEndLine !== -1 &&
        layoutInfo.requestpageEndLine < layoutInfo.reportEndLine
      ) {
        // Requestpage exists, place rendering block after it
        const intendedRenderingBlockInsertLine = layoutInfo.requestpageEndLine + 1;

        if (firstPropertyLine < intendedRenderingBlockInsertLine) {
          // DefaultRenderingLayout (at firstPropertyLine) is placed before requestpage's end.
          // So, rendering block goes after requestpage.
          renderingBlockActualInsertLine = intendedRenderingBlockInsertLine;
        } else {
          // DefaultRenderingLayout (at firstPropertyLine) is already after requestpage's end.
          // So, rendering block goes right after DefaultRenderingLayout.
          renderingBlockActualInsertLine = firstPropertyLine + 2;
        }
      } else if (
        layoutInfo.datasetEndLine !== undefined &&
        layoutInfo.datasetEndLine !== -1 &&
        layoutInfo.datasetEndLine < layoutInfo.reportEndLine
      ) {
        // No requestpage but dataset exists, place rendering block after dataset
        const intendedRenderingBlockInsertLine = layoutInfo.datasetEndLine + 1;

        if (firstPropertyLine < intendedRenderingBlockInsertLine) {
          // DefaultRenderingLayout (at firstPropertyLine) is placed before dataset's end.
          // So, rendering block goes after dataset.
          renderingBlockActualInsertLine = intendedRenderingBlockInsertLine;
        } else {
          // DefaultRenderingLayout (at firstPropertyLine) is already after dataset's end.
          // So, rendering block goes right after DefaultRenderingLayout.
          renderingBlockActualInsertLine = firstPropertyLine + 2;
        }
      } else {
        // No requestpage or dataset: rendering block goes right after DefaultRenderingLayout
        renderingBlockActualInsertLine = firstPropertyLine + 2; // After DefaultRenderingLayout (1 line) and 2 newlines
      }

      edit.insert(
        document.uri,
        new vscode.Position(renderingBlockActualInsertLine, 0),
        renderingBlockItselfText + "\n"
      );
    }

    action.edit = edit;
    actions.push(action);

    logger.info(`[LayoutProperties] Generated ${actions.length} code actions`);
    return actions;
  }
}

module.exports = {
  LayoutPropertiesActionProvider,
};
