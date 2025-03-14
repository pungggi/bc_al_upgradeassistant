/**
 * Parser for C/AL objects that converts them to structured JSON
 * and filters based on ID ranges
 */
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

/**
 * Extract CONTROLS section for pages with a more flexible pattern match
 * @param {string} calCode - The C/AL code
 * @returns {Array} Array of control objects
 */
function extractControlsSection(calCode) {
  const controls = [];

  // Find the CONTROLS section - this pattern is more reliable for capturing the entire section
  const controlsMatch = calCode.match(
    /CONTROLS\s*\{([\s\S]*?)(\}\s*CODE|\}\s*\})/
  );
  if (!controlsMatch || !controlsMatch[1]) {
    return controls;
  }

  const controlsSection = controlsMatch[1];

  // More flexible regex for C/AL control definitions that handles various formatting styles
  // It matches patterns like: { ID ; Level ; Type ; SourceExpr=Something }
  const controlRegex = /{\s*(\d+)\s*;\s*\d+\s*;\s*([^;]*)\s*;([^}]*?)}/gs;

  let match;
  while ((match = controlRegex.exec(controlsSection)) !== null) {
    try {
      const controlId = parseInt(match[1].trim(), 10);
      const type = match[2].trim();
      const properties = match[3].trim();

      // Try to extract the source expression if present
      let sourceExpr = "";
      const sourceExprMatch = properties.match(/SourceExpr=([^;]+)(?:;|$)/);
      if (sourceExprMatch) {
        sourceExpr = sourceExprMatch[1].trim();
      }

      controls.push({
        id: controlId,
        type,
        properties,
        sourceExpr,
        originalText: match[0],
      });
    } catch (error) {
      console.error("Error parsing control:", error);
    }
  }

  return controls;
}

/**
 * Extract PROPERTIES section for objects with better multi-line property handling
 * @param {string} calCode - The C/AL code
 * @returns {Object} Properties and triggers objects
 */
function extractPropertiesSection(calCode) {
  const properties = {};
  const triggers = []; // Changed from object to array

  // Find the regular PROPERTIES section (not OBJECT-PROPERTIES)
  // Use a more specific regex that requires "PROPERTIES" to be at the beginning of a line
  // or after whitespace, not as part of "OBJECT-PROPERTIES"
  const propertiesMatch = calCode.match(/(?:^|\s)PROPERTIES\s*\{([\s\S]*?)\}/);

  if (!propertiesMatch || !propertiesMatch[1]) {
    return { properties, triggers };
  }

  const propertiesBlock = propertiesMatch[1];

  // Enhanced regex for handling multi-line properties
  // This needs to handle both simple properties like "Editable=No;"
  // and complex ones like "CaptionML=[ENU=Vendor List;\n DES=Kreditorenliste;\n...];"

  let currentProp = null;
  let currentValue = "";
  let inMultilineValue = false;

  // Split by lines to process line by line
  const lines = propertiesBlock.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) continue;

    // Process triggers as separate properties
    if (trimmedLine.startsWith("On")) {
      const triggerMatch = trimmedLine.match(/^(On\w+)\s*=\s*(.+)/);
      if (triggerMatch) {
        const triggerName = triggerMatch[1].trim();
        let triggerCode = triggerMatch[2].trim();

        // Find multi-line trigger code between BEGIN and END
        if (triggerCode.startsWith("BEGIN")) {
          let triggerLines = [triggerCode];
          let i = lines.indexOf(line) + 1;

          // Collect all lines until we find END
          while (i < lines.length && !lines[i].trim().includes("END;")) {
            triggerLines.push(lines[i].trim());
            i++;
          }

          // Add the END line if found
          if (i < lines.length) {
            triggerLines.push(lines[i].trim());
          }

          triggerCode = triggerLines.join("\n");
        }

        // Store as object in array instead of using the name as key
        triggers.push({
          name: triggerName,
          code: triggerCode,
        });
      }
      continue;
    }

    // Check if this is the start of a multi-line value
    if (trimmedLine.includes("[")) {
      inMultilineValue = true;
      currentProp = trimmedLine.match(/^(\w+)=(.*)$/)[1].trim();
      currentValue = trimmedLine.match(/^(\w+)=(.*)$/)[2].trim();
      continue;
    }

    if (!inMultilineValue) {
      // Try to match a new property definition
      const propMatch = trimmedLine.match(/^(\w+)=(.*)$/);

      if (propMatch) {
        // Found a new property
        const propName = propMatch[1].trim();
        const propValue = propMatch[2].trim();

        // Single line property, just store it (remove trailing semicolon if present)
        properties[propName] = propValue.replace(/;$/, "");
      }
    } else {
      // We're inside a multi-line value
      currentValue += trimmedLine;

      // Check if this line contains the end of the multi-line value (ends with ;)
      if (trimmedLine.endsWith("];")) {
        inMultilineValue = false;
        properties[currentProp] = currentValue.replace(/;$/, "");
        currentProp = null;
        currentValue = "";
      }
    }
  }

  return { properties, triggers };
}

/**
 * Extract OBJECT-PROPERTIES section
 * @param {string} calCode - The C/AL code
 * @returns {Object} Object properties
 */
function extractObjectPropertiesSection(calCode) {
  const properties = {};

  // Find the OBJECT-PROPERTIES section specifically
  const objectPropertiesMatch = calCode.match(
    /OBJECT-PROPERTIES\s*\{([\s\S]*?)\}/
  );

  if (!objectPropertiesMatch || !objectPropertiesMatch[1]) {
    return properties;
  }

  const propertiesBlock = objectPropertiesMatch[1];

  // Extract individual object properties - simple key=value; format
  const propMatches = propertiesBlock.matchAll(/(\w+)=([^;]*);/g);
  for (const match of propMatches) {
    const key = match[1].trim();
    const value = match[2].trim();
    properties[key] = value;
  }

  return properties;
}

/**
 * Parse C/AL code into a structured JSON object
 * @param {string} calCode - The C/AL code to parse
 * @returns {Object} Parsed object representation
 */
function parseCALToJSON(calCode) {
  // Initialize the result object
  const result = {
    type: "",
    id: "",
    name: "",
    objectProperties: {},
    properties: {},
    triggers: [], // Changed from object to array
    fields: [],
    controls: [],
    actions: [],
    code: "",
    documentation: "",
  };

  // Extract object type, ID, and name
  const objectMatch = calCode.match(
    /OBJECT\s+(\w+)\s+(\d+)\s+(.*?)(?:\r?\n|\{)/
  );
  if (objectMatch) {
    result.type = objectMatch[1];
    result.id = objectMatch[2];
    result.name = objectMatch[3].trim();
  }

  // Extract OBJECT-PROPERTIES section using the dedicated function
  result.objectProperties = extractObjectPropertiesSection(calCode);

  // Extract PROPERTIES section with enhanced handling for multi-line properties
  const { properties, triggers } = extractPropertiesSection(calCode);
  result.properties = properties;
  result.triggers = triggers; // Store extracted triggers

  // Extract FIELDS section for tables
  if (result.type.toLowerCase() === "table") {
    const fieldsMatch = calCode.match(/FIELDS\s*\{([\s\S]*?)\}\s*KEYS/);
    if (!fieldsMatch) {
      // Early exit if FIELDS section is not found
      return;
    }
    const fieldsBlock = fieldsMatch[1];
    const fieldRegex =
      /{\s*(\d+)\s*;\s*[^;]*;\s*([^;]+)\s*;\s*([^;]+)\s*;([^}]*?)}/gs;
    let match;
    while ((match = fieldRegex.exec(fieldsBlock)) !== null) {
      const fieldId = parseInt(match[1].trim(), 10);
      const fieldName = match[2].trim();
      const dataType = match[3].trim();
      const properties = match[4].trim();

      result.fields.push({
        id: fieldId,
        name: fieldName,
        dataType,
        properties,
        originalText: match[0],
      });
    }
  }

  // Extract CONTROLS section for pages
  if (result.type.toLowerCase() === "page") {
    result.controls = extractControlsSection(calCode);
    console.log(`Extracted ${result.controls.length} controls from page`);
  }

  // Extract ACTIONS section for pages
  if (result.type.toLowerCase() === "page") {
    const actionsMatch = calCode.match(
      /ActionList\s*=\s*ACTIONS\s*\{([\s\S]*?)\}/
    );
    if (actionsMatch) {
      const actionsBlock = actionsMatch[1];
      // Extract action definitions
      // Format is typically: { ID ; Level ; Type ; Properties }
      const actionMatches = actionsBlock.matchAll(
        /{\s*(\d+)\s*;\s*(\d+)\s*;\s*(\w+)\s*;([^}]*?)}/g
      );

      for (const match of actionMatches) {
        const actionId = parseInt(match[1].trim(), 10);
        const level = parseInt(match[2].trim(), 10);
        const type = match[3].trim();
        const properties = match[4].trim();

        result.actions.push({
          id: actionId,
          level,
          type,
          properties,
          originalText: match[0],
        });
      }
    }
  }

  // Extract CODE section and documentation
  const codeMatch = calCode.match(/CODE\s*\{([\s\S]*?)\n\}\s*$/);
  if (codeMatch) {
    const codeContent = codeMatch[1].trim();

    // Improved regex that ignores whitespace between BEGIN, { and between }, END
    // Will match: BEGIN { content } END. but also BEGIN   {content}   END
    const docMatch = codeContent.match(/BEGIN\s*\{([\s\S]*?)\}\s*END\.?/i);

    if (docMatch && docMatch[1]) {
      // Extract documentation (content inside the braces)
      result.documentation = docMatch[1].trim();

      // Remove the documentation block from the code with similarly permissive pattern
      const codeWithoutDoc = codeContent.replace(
        /\s*BEGIN\s*\{[\s\S]*?\}\s*END\.?\s*/i,
        "\n    END."
      );
      result.code = codeWithoutDoc.trim();
    } else {
      result.code = codeContent;
    }
  }

  return result;
}

/**
 * Extracts and parses CaptionML property into a structured object
 * @param {string} captionML - CaptionML value from properties
 * @returns {Object} Parsed CaptionML with language keys and values
 */
function parseCaptionML(captionML) {
  const result = {};

  if (!captionML || !captionML.startsWith("[")) {
    return result;
  }

  // Remove the outer brackets
  const content = captionML.substring(1, captionML.length - 1);

  // Split by semicolon to get each language entry
  const entries = content.split(";").filter((e) => e.trim());

  for (const entry of entries) {
    const match = entry.trim().match(/([^=]+)=(.*)/);
    if (match) {
      const lang = match[1].trim();
      const text = match[2].trim();

      // Handle quoted text
      if (text.startsWith('"') && text.endsWith('"')) {
        result[lang] = text.substring(1, text.length - 1);
      } else {
        result[lang] = text;
      }
    }
  }

  return result;
}

/**
 * Filter a parsed C/AL object to only include elements with IDs in the specified ranges
 * @param {Object} parsedObject - The parsed C/AL object
 * @param {Array<{from: number, to: number}>} idRanges - Array of ID ranges
 * @returns {Object} Filtered object
 */
function filterParsedObjectByIdRanges(parsedObject, idRanges) {
  const result = { ...parsedObject };

  // Filter fields
  if (result.fields && result.fields.length > 0) {
    result.fields = result.fields.filter((field) => {
      if (isIdInRanges(field.id, idRanges)) {
        return true;
      }
      return false;
    });
  }

  // Filter controls
  if (result.controls && result.controls.length > 0) {
    result.controls = result.controls.filter((control) => {
      if (isIdInRanges(control.id, idRanges)) {
        return true;
      }
      return false;
    });
  }

  // Filter actions
  if (result.actions && result.actions.length > 0) {
    result.actions = result.actions.filter((action) => {
      if (isIdInRanges(action.id, idRanges)) {
        return true;
      }
      return false;
    });
  }

  return result;
}

/**
 * Check if an ID is within any of the allowed ID ranges
 * @param {number} id - The ID to check
 * @param {Array<{from: number, to: number}>} idRanges - Array of ID range objects
 * @returns {boolean} - Whether the ID is within any range
 */
function isIdInRanges(id, idRanges) {
  if (!idRanges || idRanges.length === 0) {
    return true; // If no ranges defined, allow all IDs
  }

  const numericId = parseInt(id, 10);
  if (isNaN(numericId)) {
    return false;
  }

  return idRanges.some(
    (range) => numericId >= range.from && numericId <= range.to
  );
}

/**
 * Rebuild the CONTROLS section with only filtered controls
 * @param {Array} controls - Filtered controls array
 * @returns {string} Rebuilt CONTROLS section
 */
function rebuildControlsSection(controls) {
  let result = "  CONTROLS\n  {\n";

  // Sort controls by ID to maintain order
  controls.sort((a, b) => a.id - b.id);

  // Add all filtered controls
  for (const control of controls) {
    result += `    ${control.originalText}\n\n`;
  }

  return result;
}

/**
 * Reconstruct C/AL code from filtered parsed object
 * @param {Object} parsedObject - The parsed and filtered C/AL object
 * @returns {string} Reconstructed C/AL code
 */
function reconstructCALFromParsed(parsedObject) {
  // Construct the output with preserved parts and our filtered controls/fields
  let result = `OBJECT ${parsedObject.type} ${parsedObject.id} ${parsedObject.name}\n{\n`;

  // Store the original properties and object properties sections for reconstruction
  let objectPropertiesText = "";
  let propertiesText = "";

  // Check if we have preserved section texts
  if (parsedObject._objectPropertiesText) {
    objectPropertiesText = parsedObject._objectPropertiesText;
  }

  if (parsedObject._propertiesText) {
    propertiesText = parsedObject._propertiesText;
  }

  // OBJECT-PROPERTIES section
  if (objectPropertiesText) {
    result += `  OBJECT-PROPERTIES\n  {\n${objectPropertiesText}  }\n`;
  }

  // PROPERTIES section
  if (propertiesText) {
    result += `  PROPERTIES\n  {\n${propertiesText}  }\n`;
  } else if (
    Object.keys(parsedObject.properties).length > 0 ||
    parsedObject.triggers.length > 0
  ) {
    result += "  PROPERTIES\n  {\n";

    // Add regular properties
    for (const [key, value] of Object.entries(parsedObject.properties)) {
      result += `    ${key}=${value};\n`;
    }

    // Add triggers (as array)
    for (const trigger of parsedObject.triggers) {
      result += `    ${trigger.name}=${trigger.code}\n`;
    }

    result += "  }\n";
  }

  // Reconstruct FIELDS section for tables
  if (
    parsedObject.type.toLowerCase() === "table" &&
    parsedObject.fields.length > 0
  ) {
    result += "  FIELDS\n  {\n";
    for (const field of parsedObject.fields) {
      result += `    ${field.originalText}\n`;
    }
    result += "  }\n";
  }

  // Reconstruct CONTROLS section for pages
  if (
    parsedObject.type.toLowerCase() === "page" &&
    parsedObject.controls.length > 0
  ) {
    result += rebuildControlsSection(parsedObject.controls);
  }

  // Reconstruct CODE section if it exists
  if (parsedObject.code || parsedObject.documentation) {
    result += "  CODE\n  {\n";

    // Add code content
    if (parsedObject.code) {
      result += parsedObject.code;

      // Check if there's documentation to add back
      if (parsedObject.documentation) {
        // Make sure we're not ending with END. already
        if (!parsedObject.code.trim().endsWith("END.")) {
          result += "\n\n    BEGIN\n    {\n      ";
          result += parsedObject.documentation.replace(/\n/g, "\n      ");
          result += "\n    }\n    END.";
        } else {
          // Replace the last END. with documentation in the BEGIN-END block
          const lastEndIndex = result.lastIndexOf("END.");
          if (lastEndIndex !== -1) {
            result =
              result.substring(0, lastEndIndex) +
              "BEGIN\n    {\n      " +
              parsedObject.documentation.replace(/\n/g, "\n      ") +
              "\n    }\n    END.";
          }
        }
      }
    }

    result += "\n  }\n";
  }

  result += "}\n";

  return result;
}

/**
 * Extract ID ranges from app.json and add customizations for IDs between 50000 and 99999
 * @returns {Array<{from: number, to: number}>} Array of ID range objects
 */
function getIdRangesFromAppJson() {
  try {
    // Try to find app.json in workspace folders
    if (
      !vscode.workspace.workspaceFolders ||
      vscode.workspace.workspaceFolders.length === 0
    ) {
      console.log("No workspace folders found");
      return [];
    }

    let appJsonPath = "";
    for (const folder of vscode.workspace.workspaceFolders) {
      const candidatePath = path.join(folder.uri.fsPath, "app.json");
      if (fs.existsSync(candidatePath)) {
        appJsonPath = candidatePath;
        break;
      }
    }

    if (!appJsonPath) {
      console.log("No app.json found in workspace folders");
      return [];
    }

    // Parse app.json
    const appJsonContent = fs.readFileSync(appJsonPath, "utf8");
    const appJson = JSON.parse(appJsonContent);

    // Extract ID ranges
    let idRanges = [];
    if (appJson.idRanges && Array.isArray(appJson.idRanges)) {
      idRanges = appJson.idRanges.map((range) => ({
        from: parseInt(range.from, 10),
        to: parseInt(range.to, 10),
      }));
    }

    console.log("Using ID ranges:", idRanges);
    return idRanges;
  } catch (error) {
    console.error("Error reading ID ranges from app.json:", error);
  }
}

/**
 * Filter C/AL code to include only fields and controls within ID ranges
 * @param {string} calCode - The C/AL code to filter
 * @param {boolean} returnDebugInfo - Whether to return additional debug information
 * @returns {Object|string} - Filtered C/AL code or object with debug info
 */
function filterCALToIdRanges(calCode, returnDebugInfo = false) {
  const idRanges = getIdRangesFromAppJson();

  if (idRanges.length === 0) {
    console.log("No ID ranges found, returning original code");
    return returnDebugInfo
      ? {
          filteredCode: calCode,
          originalParsed: null,
          filteredParsed: null,
        }
      : calCode;
  }

  try {
    // Parse CAL code to structured object
    const parsedObject = parseCALToJSON(calCode);

    // Store original code sections for reconstruction before filtering
    const objectPropertiesMatch = calCode.match(
      /OBJECT-PROPERTIES\s*\{([\s\S]*?)\}/
    );
    if (objectPropertiesMatch) {
      parsedObject._objectPropertiesText = objectPropertiesMatch[1];
    }

    const propertiesMatch = calCode.match(
      /(?:^|\s)PROPERTIES\s*\{([\s\S]*?)\}/
    );
    if (propertiesMatch) {
      parsedObject._propertiesText = propertiesMatch[1];
    }

    // Filter parsed object by ID ranges
    const filteredObject = filterParsedObjectByIdRanges(parsedObject, idRanges);

    // Reconstruct C/AL code from filtered object
    const filteredCode = reconstructCALFromParsed(filteredObject);

    if (returnDebugInfo) {
      return {
        filteredCode,
        originalParsed: parsedObject,
        filteredParsed: filteredObject,
      };
    }

    return filteredCode;
  } catch (error) {
    console.error("Error filtering C/AL code:", error);
    return returnDebugInfo
      ? {
          filteredCode: calCode,
          originalParsed: null,
          filteredParsed: null,
          error: error.message,
        }
      : calCode; // Return original code on error
  }
}

module.exports = {
  parseCALToJSON,
  filterParsedObjectByIdRanges,
  isIdInRanges,
  reconstructCALFromParsed,
  getIdRangesFromAppJson,
  filterCALToIdRanges,
  extractControlsSection,
  rebuildControlsSection,
  extractPropertiesSection,
  parseCaptionML,
  extractObjectPropertiesSection,
};
