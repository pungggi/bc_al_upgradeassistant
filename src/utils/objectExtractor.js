const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { Transform, Writable } = require("stream");
const configManager = require("./configManager");
const { checkExistingBasePath } = require("./basePathHelper");

/**
 * Transform stream that splits input into C/AL objects
 */
class ObjectSplitterTransform extends Transform {
  constructor(options = {}) {
    super({ ...options, objectMode: true });
    this.buffer = "";
    this.currentObject = {
      content: [],
      type: "",
      id: "",
      name: "",
    };
    this.isInsideObject = false;
  }

  _transform(chunk, encoding, callback) {
    try {
      const lines = (this.buffer + chunk.toString()).split(/\r?\n/);
      this.buffer = lines.pop(); // Keep last partial line in buffer

      for (const line of lines) {
        this._processLine(line);
      }
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    if (this.buffer) {
      this._processLine(this.buffer);
    }
    if (this.isInsideObject && this.currentObject.content.length > 0) {
      this.push(this._finalizeCurrentObject());
    }
    callback();
  }

  _processLine(line) {
    const isCalObject = line.trim().startsWith("OBJECT ");
    const isAlExtensionObject =
      /^\s*(tableextension|pageextension|reportextension|codeunitextension|enumextension)\s+/i.test(
        line.trim()
      );

    if (isCalObject || isAlExtensionObject) {
      if (this.isInsideObject && this.currentObject.content.length > 0) {
        this.push(this._finalizeCurrentObject());
      }

      this._startNewObject(line, isCalObject);
    }

    if (this.isInsideObject) {
      this.currentObject.content.push(line);
    }
  }

  _startNewObject(line, isCalObject) {
    this.isInsideObject = true;
    this.currentObject = {
      content: [],
      type: "",
      id: "",
      name: "",
    };

    if (isCalObject) {
      const objectMatch = line.match(/OBJECT\s+(\w+)\s+(\d+)\s+(.*)/i);
      if (objectMatch) {
        this.currentObject.type = objectMatch[1];
        this.currentObject.id = objectMatch[2];
        this.currentObject.name = objectMatch[3];
      }
    } else {
      const extensionMatch = line.match(
        /(\w+extension)\s+(\d+)\s+["']([^"']+)["']/i
      );
      if (extensionMatch) {
        this.currentObject.type = extensionMatch[1];
        this.currentObject.id = extensionMatch[2];
        this.currentObject.name = extensionMatch[3];
      }
    }
  }

  _finalizeCurrentObject() {
    const result = { ...this.currentObject };
    this.currentObject = {
      content: [],
      type: "",
      id: "",
      name: "",
    };
    return result;
  }
}

/**
 * Writable stream that handles saving objects to files
 */
class ObjectWriterStream extends Writable {
  constructor(outputPath, organizeByType, options = {}) {
    super({ ...options, objectMode: true });
    this.outputPath = outputPath;
    this.organizeByType = organizeByType;
    this.objectCountsByType = {};
    this.upgradedObjectFoldersByType = {};
    this.extractedFiles = [];
    this.writePromises = [];
  }

  _write(object, encoding, callback) {
    try {
      const fileName = this._getFileName(object.type, object.id, object.name);
      let targetFolder = this.outputPath;

      if (this.organizeByType && object.type) {
        targetFolder = path.join(this.outputPath, object.type + "s");
        this._ensureDirectoryExists(targetFolder);
        this.upgradedObjectFoldersByType[object.type] = object.type + "s";

        this.objectCountsByType[object.type] =
          (this.objectCountsByType[object.type] || 0) + 1;
      }

      const filePath = path.join(targetFolder, fileName);
      const content = object.content.join("\n") + "\n";

      // Use writeFile (async) instead of writeFileSync
      const writePromise = fs.promises.writeFile(filePath, content).then(() => {
        this.extractedFiles.push(filePath);
      });

      this.writePromises.push(writePromise);
      callback();
    } catch (error) {
      callback(error);
    }
  }

  async finalize() {
    // Wait for all writes to complete
    await Promise.all(this.writePromises);

    // Create and write summary file
    const summaryFilePath = path.join(
      this.outputPath,
      "_extraction_summary.txt"
    );
    const summaryContent = this._generateSummary();
    await fs.promises.writeFile(summaryFilePath, summaryContent);

    // Store base path in object locations
    if (Object.keys(this.upgradedObjectFoldersByType).length > 0) {
      this.upgradedObjectFoldersByType["basePath"] = this.outputPath;
    }

    return {
      files: this.extractedFiles,
      summaryFile: summaryFilePath,
      objectLocations: this.upgradedObjectFoldersByType,
    };
  }

  _ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  _getFileName(objectType, objectId, objectName) {
    if (!objectType || !objectId || !objectName) {
      return `Unknown_Object_${Date.now()}.txt`;
    }
    const cleanName = objectName
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .trim();
    return `${objectType}${objectId}_${cleanName}.txt`;
  }

  _generateSummary() {
    let content = `Extraction Summary\n`;
    content += `----------------\n`;
    content += `Extraction date: ${new Date().toLocaleString()}\n\n`;
    content += `Total objects extracted: ${this.extractedFiles.length}\n\n`;
    content += `Base extraction path: ${this.outputPath}\n\n`;
    content += `Objects by type:\n`;

    for (const type in this.objectCountsByType) {
      content += `- ${type}s: ${this.objectCountsByType[type]}\n`;
    }

    return content;
  }
}

/**
 * Extract individual C/AL objects from a text file containing multiple objects
 */
async function extractObjects(
  sourceFilePath,
  outputFolderPath = "",
  organizeByType = true
) {
  try {
    if (!outputFolderPath) {
      outputFolderPath = path.join(
        path.dirname(sourceFilePath),
        "extracted_objects"
      );
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputFolderPath)) {
      fs.mkdirSync(outputFolderPath, { recursive: true });
    }

    // Create transform and writer streams
    const splitter = new ObjectSplitterTransform();
    const writer = new ObjectWriterStream(outputFolderPath, organizeByType);

    // Process file using streams
    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(sourceFilePath, {
        encoding: "utf8",
        highWaterMark: 64 * 1024,
      });

      readStream
        .pipe(splitter)
        .pipe(writer)
        .on("finish", resolve)
        .on("error", reject);

      readStream.on("error", reject);
    });

    // Finalize writing and get results
    const result = await writer.finalize();

    // Save the upgraded object folders to configuration
    if (Object.keys(result.objectLocations).length > 0) {
      const { proceed, overwrite } = await checkExistingBasePath(configManager);

      if (!proceed) {
        return {
          success: false,
          message: "Operation cancelled by user",
        };
      }

      if (overwrite) {
        await configManager.setConfigValue(
          "upgradedObjectFolders",
          result.objectLocations
        );
      }
    }

    return {
      ...result,
      success: true,
    };
  } catch (error) {
    console.error("Error extracting objects:", error);
    throw error;
  }
}

// Keep existing helper functions
const {
  getUpgradedObjectFoldersByType,
  getLocationForObjectType,
} = require("./objectExtractorHelpers");

// Export the functionality
module.exports = {
  extractObjects,
  extractObjectsFromPath,
  getUpgradedObjectFoldersByType,
  getLocationForObjectType,
};

/**
 * Extract objects from a selected file path through a dialog
 */
async function extractObjectsFromPath() {
  try {
    const { proceed, overwrite } = await checkExistingBasePath(configManager);

    if (!proceed) {
      return;
    }

    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Select C/AL file to extract objects from",
      filters: {
        "CAL Files": ["txt"],
        "All Files": ["*"],
      },
    });

    if (!fileUris || fileUris.length === 0) return;

    const sourceFilePath = fileUris[0].fsPath;
    let outputFolderPath = "";

    const outputFolderUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select output folder",
    });

    if (outputFolderUri && outputFolderUri.length > 0) {
      outputFolderPath = outputFolderUri[0].fsPath;
    } else {
      outputFolderPath = path.join(
        path.dirname(sourceFilePath),
        "extracted_objects"
      );
    }

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Splitting C/AL objects",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0, message: "Reading source file..." });
        const result = await extractObjects(
          sourceFilePath,
          outputFolderPath,
          true
        );
        progress.report({
          increment: 100,
          message: `Completed! Extracted ${result.files.length} objects`,
        });
        return result;
      }
    );

    if (!result || result.success === false) {
      if (result && result.message) {
        vscode.window.showInformationMessage(result.message);
      }
      return;
    }

    if (
      result.objectLocations &&
      Object.keys(result.objectLocations).length > 0 &&
      overwrite
    ) {
      await configManager.setConfigValue(
        "upgradedObjectFolders",
        result.objectLocations
      );
      vscode.window.showInformationMessage(
        "Object folder locations have been saved to your settings."
      );
    }

    const fileCount = result.files.length || 0;
    const summaryUri = vscode.Uri.file(result.summaryFile);

    vscode.window
      .showInformationMessage(
        `Successfully extracted ${fileCount} objects to "${outputFolderPath}"`,
        {
          modal: false,
          detail: "Click 'View Summary' to see extraction details",
        },
        { title: "View Summary" }
      )
      .then((selection) => {
        if (selection && selection.title === "View Summary") {
          vscode.workspace
            .openTextDocument(summaryUri)
            .then((doc) => vscode.window.showTextDocument(doc));
        }
      });
  } catch (error) {
    console.error("Error extracting objects:", error);
    vscode.window.showErrorMessage(
      `Error extracting objects: ${error.message}`
    );
  }
}
