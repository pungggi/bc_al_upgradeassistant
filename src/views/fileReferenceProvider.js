const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

/**
 * Tree data provider for BC/AL file references
 */
class FileReferenceProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Listen for file change events
    this.disposable = vscode.window.onDidChangeActiveTextEditor((editor) =>
      this._onActiveEditorChanged(editor)
    );

    // Store current editor
    this.activeEditor = vscode.window.activeTextEditor;
  }

  /**
   * Handle active editor changes
   * @param {vscode.TextEditor} editor The new active editor
   */
  _onActiveEditorChanged(editor) {
    this.activeEditor = editor;
    this._onDidChangeTreeData.fire(null);
  }

  /**
   * Refresh the tree view
   */
  refresh() {
    this._onDidChangeTreeData.fire(null);
  }

  /**
   * Get children for the tree view
   * @param {TreeItem} element The parent element
   * @returns {Promise<TreeItem[]>} The child elements
   */
  async getChildren(element) {
    // If no active editor, show placeholder
    if (!this.activeEditor) {
      return [new NoFileItem()];
    }

    // If we have a parent element, get its children
    if (element) {
      return element.getChildren();
    }

    // Root elements are based on the current file
    const filePath = this.activeEditor.document.uri.fsPath;
    const fileExt = path.extname(filePath).toLowerCase();

    if (fileExt === ".txt") {
      return this._getTxtFileReferences(filePath);
    } else if (fileExt === ".al") {
      return this._getAlFileReferences(filePath);
    } else {
      return [new UnsupportedFileItem()];
    }
  }

  /**
   * Get tree item for element
   * @param {TreeItem} element The element
   * @returns {vscode.TreeItem} The tree item
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * Get references for a .txt file (original C/AL file)
   * @param {string} filePath Path to the .txt file
   * @returns {Promise<TreeItem[]>} Tree items
   */
  async _getTxtFileReferences(filePath) {
    try {
      // Find the .index folder
      const indexFolder = this._findIndexFolder();
      if (!indexFolder) {
        return [
          new TreeItem(
            "No index folder found",
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      // Look for reference file in the index folder
      const fileName = path.basename(filePath);
      const referenceFileName = fileName.replace(/\.txt$/, ".json");
      const referenceFilePath = path.join(indexFolder, referenceFileName);

      if (!fs.existsSync(referenceFilePath)) {
        return [
          new TreeItem(
            "No references found for this file",
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      // Read and parse the reference file
      const referenceData = JSON.parse(
        fs.readFileSync(referenceFilePath, "utf8")
      );
      if (
        !referenceData.referencedWorkingObjects ||
        referenceData.referencedWorkingObjects.length === 0
      ) {
        return [
          new TreeItem(
            "No referenced objects found",
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      // Create tree items for each referenced object
      return referenceData.referencedWorkingObjects.map((ref) => {
        return new ReferencedObjectItem(ref.type, ref.number, indexFolder);
      });
    } catch (error) {
      console.error("Error getting .txt file references:", error);
      return [
        new TreeItem(
          `Error: ${error.message}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }
  }

  /**
   * Get references for an AL file
   * @param {string} filePath Path to the AL file
   * @returns {Promise<TreeItem[]>} Tree items
   */
  async _getAlFileReferences(filePath) {
    try {
      // Extract object info from AL file
      const objectInfo = this._extractAlObjectInfo(filePath);
      if (!objectInfo) {
        return [
          new TreeItem(
            "Not a valid AL object file",
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      // Find the .index folder
      const indexFolder = this._findIndexFolder();
      if (!indexFolder) {
        return [
          new InfoItem(
            "AL File",
            objectInfo.type + " " + objectInfo.id + " " + objectInfo.name
          ),
        ];
      }

      // Look for info.json in the object's index folder
      const objectFolder = path.join(
        indexFolder,
        objectInfo.type.toLowerCase(),
        objectInfo.id
      );
      const infoFilePath = path.join(objectFolder, "info.json");

      if (!fs.existsSync(infoFilePath)) {
        // If no info.json, just show the object info
        return [
          new InfoItem(
            "AL File",
            objectInfo.type + " " + objectInfo.id + " " + objectInfo.name
          ),
        ];
      }

      // Read and parse the info file
      const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));

      // Create result array starting with object info
      const result = [
        new InfoItem("Object Type", objectInfo.type),
        new InfoItem("Object ID", objectInfo.id),
        new InfoItem("Object Name", objectInfo.name),
      ];

      if (infoData.indexedAt) {
        result.push(
          new InfoItem(
            "Indexed At",
            new Date(infoData.indexedAt).toLocaleString()
          )
        );
      }

      if (
        infoData.referencedMigrationFiles &&
        infoData.referencedMigrationFiles.length > 0
      ) {
        // Add referenced migration files group
        result.push(new MigrationFilesItem(infoData.referencedMigrationFiles));
      }

      return result;
    } catch (error) {
      console.error("Error getting AL file references:", error);
      return [
        new TreeItem(
          `Error: ${error.message}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }
  }

  /**
   * Find the .index folder path
   * @returns {string|null} Path to the .index folder or null if not found
   */
  _findIndexFolder() {
    const configManager = require("../utils/configManager");
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );

    if (upgradedObjectFolders && upgradedObjectFolders.basePath) {
      const indexPath = path.join(upgradedObjectFolders.basePath, ".index");
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }

    // Try to find it in workspace folders
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const potentialPath = path.join(folder.uri.fsPath, ".index");
        if (fs.existsSync(potentialPath)) {
          return potentialPath;
        }
      }
    }

    return null;
  }

  /**
   * Extract AL object info from file content
   * @param {string} filePath Path to the AL file
   * @returns {{type: string, id: string, name: string}|null} Object info or null
   */
  _extractAlObjectInfo(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");

      // Look for object declaration
      const patterns = [
        // tableextension, pageextension, etc.
        /\b(tableextension|pageextension|reportextension|codeunitextension)\s+(\d+)\s+["']([^"']+)["']/i,
        // table, page, report, codeunit, etc.
        /\b(table|page|report|codeunit|query|xmlport|enum|profile|interface)\s+(\d+)\s+["']([^"']+)["']/i,
        // permissionset
        /\b(permissionset)\s+(\w+)\s+/i,
      ];

      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          return {
            type: match[1],
            id: match[2],
            name: match[3] || match[2], // For permissionsets with no numeric ID
          };
        }
      }

      return null;
    } catch (error) {
      console.error("Error extracting AL object info:", error);
      return null;
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.disposable) {
      this.disposable.dispose();
    }
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Base tree item class
 */
class TreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState) {
    super(label, collapsibleState);
  }

  getChildren() {
    return [];
  }
}

/**
 * Tree item for no file selected
 */
class NoFileItem extends TreeItem {
  constructor() {
    super("No file selected", vscode.TreeItemCollapsibleState.None);
    this.description = "Open a .txt or .al file to see references";
    this.contextValue = "noFile";
  }
}

/**
 * Tree item for unsupported file types
 */
class UnsupportedFileItem extends TreeItem {
  constructor() {
    super("Unsupported file type", vscode.TreeItemCollapsibleState.None);
    this.description = "Only .txt and .al files are supported";
    this.contextValue = "unsupportedFile";
  }
}

/**
 * Tree item for referenced objects
 */
class ReferencedObjectItem extends TreeItem {
  constructor(type, id, indexFolder) {
    const label = `${type} ${id}`;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "referencedObject";
    this.command = {
      command: "bc-al-upgradeassistant.openReferencedObject",
      title: "Open Object",
      arguments: [type, id, indexFolder],
    };
    this.iconPath = new vscode.ThemeIcon("file-code");

    // Try to get object name
    const objectFolder = path.join(indexFolder, type.toLowerCase(), id);
    const infoFilePath = path.join(objectFolder, "info.json");

    if (fs.existsSync(infoFilePath)) {
      try {
        const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));
        if (infoData.fileName) {
          const fileNameMatch = infoData.fileName.match(/_(.+)\.al$/);
          if (fileNameMatch) {
            this.description = fileNameMatch[1].replace(/_/g, " ");
          }
        }
      } catch (error) {
        // Ignore errors in getting description
      }
    }
  }
}

/**
 * Tree item for info key-value
 */
class InfoItem extends TreeItem {
  constructor(key, value) {
    super(key, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.contextValue = "infoItem";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

/**
 * Tree item for migration files
 */
class MigrationFilesItem extends TreeItem {
  constructor(files) {
    super(
      "Referenced Migration Files",
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.files = files;
    this.contextValue = "migrationFiles";
    this.iconPath = new vscode.ThemeIcon("references");
  }

  getChildren() {
    return this.files.map((file) => {
      const item = new TreeItem(
        path.basename(file),
        vscode.TreeItemCollapsibleState.None
      );
      item.command = {
        command: "bc-al-upgradeassistant.openMigrationFile",
        title: "Open Migration File",
        arguments: [file],
      };
      item.iconPath = new vscode.ThemeIcon("file");
      return item;
    });
  }
}

module.exports = FileReferenceProvider;
