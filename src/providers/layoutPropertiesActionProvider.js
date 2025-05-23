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
  const lines = text.split('\n');

  // Find all reports and their layout properties
  const allReports = [];

  // First pass: find all reports and their boundaries
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for report declaration
    const reportPattern = /^\s*report\s+(\d+)\s+"([^"]+)"\s*$/;
    const reportMatch = line.match(reportPattern);

    if (reportMatch) {
      const report = {
        reportId: reportMatch[1],
        reportName: reportMatch[2],
        reportStartLine: i,
        reportEndLine: -1,
        layoutProperties: [],
        baseIndentation: null
      };

      // Find the matching closing brace
      let braceCount = 0;
      let foundOpenBrace = false;

      for (let j = i; j < lines.length; j++) {
        const currentLine = lines[j];

        // Count braces
        for (const char of currentLine) {
          if (char === '{') {
            braceCount++;
            foundOpenBrace = true;
          } else if (char === '}') {
            braceCount--;
            if (foundOpenBrace && braceCount === 0) {
              report.reportEndLine = j;
              break;
            }
          }
        }

        if (report.reportEndLine !== -1) break;
      }

      report.baseIndentation = getBaseIndentation(lines, i);
      allReports.push(report);
    }
  }

  // Second pass: find layout properties within each report
  for (const report of allReports) {
    for (let i = report.reportStartLine; i <= report.reportEndLine; i++) {
      const line = lines[i];

      // Match RDLCLayout property
      const rdlcMatch = line.match(/^(\s*)(RDLCLayout)\s*=\s*['"]([^'"]+)['"];?\s*$/);
      if (rdlcMatch) {
        report.layoutProperties.push({
          type: 'RDLC',
          originalProperty: 'RDLCLayout',
          path: rdlcMatch[3],
          lineNumber: i,
          indentation: rdlcMatch[1],
          fullLine: line
        });
      }

      // Match WordLayout property
      const wordMatch = line.match(/^(\s*)(WordLayout)\s*=\s*['"]([^'"]+)['"];?\s*$/);
      if (wordMatch) {
        report.layoutProperties.push({
          type: 'Word',
          originalProperty: 'WordLayout',
          path: wordMatch[3],
          lineNumber: i,
          indentation: wordMatch[1],
          fullLine: line
        });
      }
    }
  }

  // Filter reports that have layout properties
  const reportsWithLayoutProperties = allReports.filter(report => report.layoutProperties.length > 0);

  if (reportsWithLayoutProperties.length === 0) {
    return null;
  }

  // For now, return the first report with layout properties
  // In the future, we could return all reports or the one that intersects with the range
  const firstReport = reportsWithLayoutProperties[0];

  return {
    reportId: firstReport.reportId,
    reportName: firstReport.reportName,
    reportStartLine: firstReport.reportStartLine,
    reportEndLine: firstReport.reportEndLine,
    layoutProperties: firstReport.layoutProperties,
    baseIndentation: firstReport.baseIndentation,
    allReports: reportsWithLayoutProperties // Include all reports for potential future use
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
  for (let i = reportStartLine; i < Math.min(reportStartLine + 5, lines.length); i++) {
    const line = lines[i];
    if (line.includes('{')) {
      const match = line.match(/^(\s*)/);
      return match ? match[1] + '  ' : '  '; // Add 2 spaces for content inside braces
    }
  }
  return '  '; // Default indentation
}

/**
 * Generate the new rendering block syntax
 * @param {Object} layoutInfo - The layout properties information
 * @returns {string} - The new rendering block
 */
function generateRenderingBlock(layoutInfo) {
  const { layoutProperties, baseIndentation } = layoutInfo;
  const indent = baseIndentation;
  const layoutIndent = indent + '  ';
  const propertyIndent = layoutIndent + '  ';

  let renderingBlock = `${indent}rendering\n${indent}{\n`;

  layoutProperties.forEach((prop, index) => {
    const layoutName = prop.originalProperty; // Keep original name for layout identifier
    renderingBlock += `${layoutIndent}layout(${layoutName})\n`;
    renderingBlock += `${layoutIndent}{\n`;
    renderingBlock += `${propertyIndent}Type = ${prop.type};\n`;
    renderingBlock += `${propertyIndent}LayoutFile = '${prop.path}';\n`;
    renderingBlock += `${layoutIndent}}`;

    // Add newline if not the last property
    if (index < layoutProperties.length - 1) {
      renderingBlock += '\n';
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
   * @param {vscode.CodeActionContext} context - The context
   * @returns {vscode.CodeAction[]} - The code actions
   */
  async provideCodeActions(document, range, context) {
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

    logger.info(`[LayoutProperties] Found ${layoutInfo.layoutProperties.length} layout properties in report ${layoutInfo.reportId}`);

    const actions = [];

    // Create the main transformation action
    const action = new vscode.CodeAction(
      `Transform to new rendering syntax (${layoutInfo.layoutProperties.length} layout${layoutInfo.layoutProperties.length > 1 ? 's' : ''})`,
      vscode.CodeActionKind.RefactorRewrite
    );

    action.isPreferred = true;

    // Create the edit to replace old layout properties with new rendering block
    const edit = new vscode.WorkspaceEdit();

    // Sort layout properties by line number (descending) to replace from bottom to top
    const sortedProperties = [...layoutInfo.layoutProperties].sort((a, b) => b.lineNumber - a.lineNumber);

    // Remove old layout property lines
    for (const prop of sortedProperties) {
      const lineRange = new vscode.Range(
        new vscode.Position(prop.lineNumber, 0),
        new vscode.Position(prop.lineNumber + 1, 0)
      );
      edit.delete(document.uri, lineRange);
    }

    // Insert new rendering block at the position of the first layout property
    const firstProperty = layoutInfo.layoutProperties.reduce((first, current) =>
      current.lineNumber < first.lineNumber ? current : first
    );

    const insertPosition = new vscode.Position(firstProperty.lineNumber, 0);
    const renderingBlock = generateRenderingBlock(layoutInfo);

    edit.insert(document.uri, insertPosition, renderingBlock + '\n');

    action.edit = edit;
    actions.push(action);

    // Add individual transformation actions for each layout property
    for (const prop of layoutInfo.layoutProperties) {
      const individualAction = new vscode.CodeAction(
        `Transform ${prop.originalProperty} to new syntax`,
        vscode.CodeActionKind.RefactorRewrite
      );

      const individualEdit = new vscode.WorkspaceEdit();

      // Replace just this property with its rendering block equivalent
      const propRange = new vscode.Range(
        new vscode.Position(prop.lineNumber, 0),
        new vscode.Position(prop.lineNumber + 1, 0)
      );

      const singleLayoutInfo = {
        ...layoutInfo,
        layoutProperties: [prop]
      };

      const singleRenderingBlock = generateRenderingBlock(singleLayoutInfo);
      individualEdit.replace(document.uri, propRange, singleRenderingBlock + '\n');

      individualAction.edit = individualEdit;
      actions.push(individualAction);
    }

    logger.info(`[LayoutProperties] Generated ${actions.length} code actions`);
    return actions;
  }
}

module.exports = {
  LayoutPropertiesActionProvider,
};
