const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const documentationHelper = require("../utils/documentationHelper");

/**
 * Tree data provider for BC/AL file references
 */
class FileReferenceProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Store expanded state
    this.expandedState = new Map();

    // Load expanded state from storage
    this.storageLoaded = false;
    this.extensionContext = null;

    // Listen for file change events
    this.disposable = vscode.window.onDidChangeActiveTextEditor((editor) =>
      this._onActiveEditorChanged(editor)
    );

    // Store current editor
    this.activeEditor = vscode.window.activeTextEditor;

    // Load documentation IDs from settings
    this.configManager = require("../utils/configManager");
    this.documentationIds = this.configManager.getMergedDocumentationIds();

    // Also listen for configuration changes to reload IDs
    this.configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("bc-al-upgradeassistant.documentationIds")) {
        this.documentationIds = this.configManager.getMergedDocumentationIds();
        this.refresh();
      }
    });

    // Create decoration type for done references with more prominent styling
    this.doneDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: path.join(__dirname, "..", "..", "media", "check.svg"),
      gutterIconSize: "100%",
      fontWeight: "normal",
      color: new vscode.ThemeColor("editorGutter.addedBackground"),
      isWholeLine: true,
      // before: {
      //   contentText: "✓",
      //   color: new vscode.ThemeColor("editorGutter.addedBackground"),
      //   margin: "0 0 0 0",
      // },
    });

    // Create decoration type for undone references
    this.undoneDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: path.join(
        __dirname,
        "..",
        "..",
        "media",
        "unchecked.svg"
      ),
      gutterIconSize: "100%",
      fontWeight: "bold",
      isWholeLine: true,
    });

    // Create decoration type for not implemented references
    this.notImplementedDecorationType =
      vscode.window.createTextEditorDecorationType({
        gutterIconPath: path.join(
          __dirname,
          "..",
          "..",
          "media",
          "not-implemented.svg"
        ),
        gutterIconSize: "100%",
        fontWeight: "normal",
        color: new vscode.ThemeColor("editorGutter.deletedBackground"),
        isWholeLine: true,
        opacity: "0.7",
      });

    // Track current editor
    this.currentEditor = vscode.window.activeTextEditor;

    // Listen for editor changes to update decorations
    this.editorChangeDisposable = [
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.currentEditor = editor;
        if (editor) {
          this.updateDecorations();
        }
      }),
      // Add listener for document changes
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          this.currentEditor &&
          event.document === this.currentEditor.document
        ) {
          this.updateDecorations();
        }
      }),
      // Add listener for when text editor is opened
      vscode.window.onDidChangeVisibleTextEditors(() => {
        if (this.currentEditor) {
          this.updateDecorations();
        }
      }),
    ];

    // Initial decoration update
    if (this.currentEditor) {
      this.updateDecorations();
    }
  }

  /**
   * Initialize with extension context for storage
   * @param {vscode.ExtensionContext} context Extension context
   */
  initialize(context) {
    this.extensionContext = context;
    this.loadExpandedState();
  }

  /**
   * Load expanded state from storage
   */
  loadExpandedState() {
    if (!this.extensionContext) return;

    try {
      const state = this.extensionContext.globalState.get(
        "treeViewExpandedState"
      );
      if (state && Array.isArray(state)) {
        this.expandedState.clear();
        state.forEach((id) => this.expandedState.set(id, true));
      }
      this.storageLoaded = true;
      console.log(`Loaded ${this.expandedState.size} expanded tree items`);
    } catch (error) {
      console.error("Error loading expanded state:", error);
    }
  }

  /**
   * Save expanded state to storage
   */
  saveExpandedState() {
    if (!this.extensionContext) return;

    try {
      // Convert Map keys of expanded items to array
      const expandedItems = Array.from(this.expandedState.entries())
        .filter(([, isExpanded]) => isExpanded)
        .map(([id]) => id);

      this.extensionContext.globalState.update(
        "treeViewExpandedState",
        expandedItems
      );
      console.log(`Saved ${expandedItems.length} expanded tree items`);
    } catch (error) {
      console.error("Error saving expanded state:", error);
    }
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
    // Check if we have stored state for this element and it should be expanded
    if (
      element.id &&
      element.collapsibleState !== vscode.TreeItemCollapsibleState.None
    ) {
      const isExpanded = this.expandedState.get(element.id);
      if (isExpanded !== undefined) {
        element.collapsibleState = isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;
      }
    }
    return element;
  }

  /**
   * Save expanded state for an item
   * @param {string} itemId ID of the item
   * @param {boolean} isExpanded Whether the item is expanded
   */
  setItemExpandedState(itemId, isExpanded) {
    if (!itemId) return;

    this.expandedState.set(itemId, isExpanded);
    this.saveExpandedState();
  }

  /**
   * Get references for a .txt file (original C/AL file)
   * @param {string} filePath Path to the .txt file
   * @returns {Promise<TreeItem[]>} Tree items
   */
  async _getTxtFileReferences(filePath) {
    try {
      // Safety check for filePath type
      if (typeof filePath !== "string") {
        console.error("Invalid file path type:", typeof filePath, filePath);
        return [
          new TreeItem(
            "Invalid file path",
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

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

      const result = [];

      // Read file content and look for documentation IDs
      const fileContent = fs.readFileSync(filePath, "utf8");
      const documentationRefs = this._findDocumentationReferences(
        fileContent,
        filePath
      );

      // Check for reference file
      if (fs.existsSync(referenceFilePath)) {
        try {
          const referenceData = JSON.parse(
            fs.readFileSync(referenceFilePath, "utf8")
          );

          if (referenceData.referencedWorkingObjects?.length > 0) {
            const referencedObjects =
              referenceData.referencedWorkingObjects.map((ref) => {
                return new ReferencedObjectItem(
                  ref.type,
                  ref.number.toString(),
                  indexFolder
                );
              });
            result.push(new ReferencedObjectsGroup(referencedObjects));
          }
        } catch (parseError) {
          console.error("Error parsing reference file:", parseError);
          result.push(
            new TreeItem(
              `Error reading references: ${parseError.message}`,
              vscode.TreeItemCollapsibleState.None
            )
          );
        }
      }

      // Add documentation references after referenced objects
      if (documentationRefs.length > 0) {
        result.push(new DocumentationRefsItem(documentationRefs, filePath));
      }

      // If no items added, show a message
      if (result.length === 0) {
        result.push(
          new TreeItem(
            "No references found for this file",
            vscode.TreeItemCollapsibleState.None
          )
        );
      }

      this.updateDecorations();
      return result;
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

      const result = [];

      // Find the .index folder
      const indexFolder = this._findIndexFolder();
      if (!indexFolder) {
        return result;
      }

      // Look for info.json in the object's index folder
      const objectFolder = path.join(
        indexFolder,
        objectInfo.type.toLowerCase(),
        objectInfo.id
      );
      const infoFilePath = path.join(objectFolder, "info.json");

      if (!fs.existsSync(infoFilePath)) {
        return result;
      }

      // Read and parse the info file
      const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));

      if (infoData.indexedAt) {
        result.push(
          new InfoItem(
            "Indexed At",
            new Date(infoData.indexedAt).toLocaleString()
          )
        );
      }

      // Check for migration files
      if (
        infoData.referencedMigrationFiles &&
        infoData.referencedMigrationFiles.length > 0
      ) {
        // Add referenced migration files group
        const migrationFiles = infoData.referencedMigrationFiles;

        // For each migration file, scan for documentation IDs
        const migrationFileRefs = [];

        for (const migFile of migrationFiles) {
          if (fs.existsSync(migFile)) {
            const content = fs.readFileSync(migFile, "utf8");
            const docRefs = this._findDocumentationReferences(content, migFile);
            if (docRefs.length > 0) {
              migrationFileRefs.push({
                file: migFile,
                refs: docRefs,
              });
            }
          }
        }

        // Create migration files node with documentation references
        result.push(
          new EnhancedMigrationFilesItem(migrationFiles, migrationFileRefs)
        );
      }

      return result;
    } catch (error) {
      console.error("Error retrieving AL file references:", error);
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
   * Find documentation references in file content
   * @param {string} content The file content
   * @param {string} filePath Path to the file
   * @returns {Array<{id: string, lineNumber: number, description: string, done: boolean, notImplemented: boolean}>} Documentation references Documentation references
   */
  _findDocumentationReferences(content, filePath) {
    if (!content) {
      return [];
    }

    // Create regex pattern from documentation IDs
    const { idMap, regex } = documentationHelper.createDocumentationRegex(
      this.documentationIds
    );
    if (!regex) {
      console.log("No documentation IDs configured");
      return [];
    }

    // Find references
    const docRefs = documentationHelper.findDocumentationReferences(
      content,
      regex,
      idMap,
      filePath
    );

    // Enhance with "done" status from storage
    docRefs.forEach((ref) => {
      const refData = this._getDocumentationReferenceData(
        filePath,
        ref.id,
        ref.lineNumber
      );
      ref.done = refData ? refData.done : false;
      ref.notImplemented = refData ? refData.notImplemented : false;
      ref.userDescription = refData ? refData.userDescription : "";
      ref.userId = refData ? refData.userId : "";
    });

    return docRefs;
  }

  /**
   * Get stored data for a documentation reference
   * @param {string} filePath File path
   * @param {string} id Documentation ID
   * @param {number} lineNumber Line number
   * @returns {any} Stored reference data or null
   */
  _getDocumentationReferenceData(filePath, id, lineNumber) {
    try {
      const storageFile = this._getDocumentationStorageFile();
      if (!fs.existsSync(storageFile)) {
        return null;
      }

      const storageData = JSON.parse(fs.readFileSync(storageFile, "utf8"));
      const fileKey = this._normalizePathForStorage(filePath);

      if (storageData[fileKey] && storageData[fileKey].references) {
        return storageData[fileKey].references.find(
          (ref) => ref.id === id && ref.lineNumber === lineNumber
        );
      }

      return null;
    } catch (error) {
      console.error("Error reading documentation reference data:", error);
      return null;
    }
  }

  /**
   * Normalize a file path for storage as a key
   * @param {string} filePath File path
   * @returns {string} Normalized path
   */
  _normalizePathForStorage(filePath) {
    return documentationHelper.normalizePathForStorage(filePath);
  }

  /**
   * Get path to documentation references storage file
   * @returns {string} Path to storage file
   */
  _getDocumentationStorageFile() {
    return documentationHelper.getDocumentationStorageFile(() =>
      this._findIndexFolder()
    );
  }

  /**
   * Toggle the "done" state of a documentation reference
   * @param {string} filePath File path
   * @param {string} id Documentation ID
   * @param {number} lineNumber Line number
   * @returns {boolean} New "done" state
   */
  toggleDocumentationReferenceDone(filePath, id, lineNumber) {
    const result = (() => {
      try {
        const storageFile = this._getDocumentationStorageFile();

        // Read existing data or create new
        let storageData = {};
        if (fs.existsSync(storageFile)) {
          storageData = JSON.parse(fs.readFileSync(storageFile, "utf8"));
        }

        const fileKey = this._normalizePathForStorage(filePath);
        const config = vscode.workspace.getConfiguration(
          "bc-al-upgradeassistant"
        );
        const userId = config.get("userId");

        // Initialize file entry if needed
        if (!storageData[fileKey]) {
          storageData[fileKey] = {
            references: [],
          };
        }

        // Find existing reference or add new one
        let ref = storageData[fileKey].references.find(
          (r) => r.id === id && r.lineNumber === lineNumber
        );

        if (ref) {
          // Toggle state
          ref.done = !ref.done;
          // Silently add/update userId
          if (userId) {
            ref.userId = userId;
            ref.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          ref = {
            id,
            lineNumber,
            done: true,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(ref);
        }

        // Save updated data
        fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

        // Fire change event to refresh tree
        this.refresh();

        return ref.done;
      } catch (error) {
        console.error("Error toggling documentation reference state:", error);
        return false;
      }
    })();

    // Update decorations after toggling
    this.updateDecorations();

    return result;
  }

  /**
   * Toggle the "not implemented" state of a documentation reference
   * @param {string} filePath File path
   * @param {string} id Documentation ID
   * @param {number} lineNumber Line number
   * @returns {boolean} New "not implemented" state
   */
  toggleDocumentationReferenceNotImplemented(filePath, id, lineNumber) {
    const result = (() => {
      try {
        const storageFile = this._getDocumentationStorageFile();

        // Read existing data or create new
        let storageData = {};
        if (fs.existsSync(storageFile)) {
          storageData = JSON.parse(fs.readFileSync(storageFile, "utf8"));
        }

        const fileKey = this._normalizePathForStorage(filePath);
        const config = vscode.workspace.getConfiguration(
          "bc-al-upgradeassistant"
        );
        const userId = config.get("userId");

        // Initialize file entry if needed
        if (!storageData[fileKey]) {
          storageData[fileKey] = {
            references: [],
          };
        }

        // Find existing reference or add new one
        let ref = storageData[fileKey].references.find(
          (r) => r.id === id && r.lineNumber === lineNumber
        );

        if (ref) {
          // Toggle not implemented state
          ref.notImplemented = !ref.notImplemented;
          // Silently add/update userId
          if (userId) {
            ref.userId = userId;
            ref.lastModified = new Date().toISOString();
          }

          // If marked as not implemented, it shouldn't be marked as done
          if (ref.notImplemented && ref.done) {
            ref.done = false;
          }
        } else {
          // Add new entry
          ref = {
            id,
            lineNumber,
            done: false,
            notImplemented: true,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(ref);
        }

        // Save updated data
        fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

        // Fire change event to refresh tree
        this.refresh();

        return ref.notImplemented;
      } catch (error) {
        console.error(
          "Error toggling documentation reference not implemented state:",
          error
        );
        return false;
      }
    })();

    // Update decorations after toggling
    this.updateDecorations();

    return result;
  }

  /**
   * Set description for a documentation reference
   * @param {string} filePath File path
   * @param {string} id Documentation ID
   * @param {number} lineNumber Line number
   * @param {string} description User-provided description
   * @returns {boolean} Success status
   */
  setDocumentationReferenceDescription(filePath, id, lineNumber, description) {
    try {
      const storageFile = this._getDocumentationStorageFile();

      // Read existing data or create new
      let storageData = {};
      if (fs.existsSync(storageFile)) {
        storageData = JSON.parse(fs.readFileSync(storageFile, "utf8"));
      }

      const fileKey = this._normalizePathForStorage(filePath);

      // Initialize file entry if needed
      if (!storageData[fileKey]) {
        storageData[fileKey] = {
          references: [],
        };
      }

      // Find existing reference or add new one
      let ref = storageData[fileKey].references.find(
        (r) => r.id === id && r.lineNumber === lineNumber
      );

      if (ref) {
        // Update description
        ref.userDescription = description;
      } else {
        // Add new entry
        ref = { id, lineNumber, userDescription: description };
        storageData[fileKey].references.push(ref);
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      return true;
    } catch (error) {
      console.error(
        "Error setting documentation reference description:",
        error
      );
      return false;
    }
  }

  updateDecorations() {
    if (!this.currentEditor) {
      return;
    }

    // Only apply decorations for .txt files
    const filePath = this.currentEditor.document.uri.fsPath;
    const fileExt = path.extname(filePath).toLowerCase();
    if (fileExt !== ".txt") {
      return;
    }

    try {
      const doneDecorations = [];
      const undoneDecorations = [];
      const notImplementedDecorations = [];

      const docRefs = this._findDocumentationReferences(
        this.currentEditor.document.getText(),
        filePath
      );

      docRefs.forEach((ref) => {
        const line = ref.lineNumber - 1;
        const range = new vscode.Range(
          new vscode.Position(line, 0),
          new vscode.Position(line, Number.MAX_VALUE)
        );

        if (ref.notImplemented) {
          notImplementedDecorations.push(range);
        } else if (ref.done) {
          doneDecorations.push(range);
        } else {
          undoneDecorations.push(range);
        }
      });

      this.currentEditor.setDecorations(
        this.doneDecorationType,
        doneDecorations
      );
      this.currentEditor.setDecorations(
        this.undoneDecorationType,
        undoneDecorations
      );
      this.currentEditor.setDecorations(
        this.notImplementedDecorationType,
        notImplementedDecorations
      );
    } catch (error) {
      console.error("Error updating decorations:", error);
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.disposable) {
      this.disposable.dispose();
    }
    if (this.configDisposable) {
      this.configDisposable.dispose();
    }

    // Save state before disposing
    this.saveExpandedState();

    this._onDidChangeTreeData.dispose();
    if (this.editorChangeDisposable) {
      this.editorChangeDisposable.forEach((d) => d.dispose());
    }
    this.doneDecorationType.dispose();
    this.undoneDecorationType.dispose();
    this.notImplementedDecorationType.dispose();
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

    // Add example documentation IDs for testing
    this.tooltip =
      "Documentation ID examples: BC0001, CUSTOM001, #PKZZ900/09:999111";
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

    // Store these properties for use with the delete command
    this.type = type;
    this.id = id;
    this.indexFolder = indexFolder;

    // Try to get object name
    const objectFolder = path.join(indexFolder, type.toLowerCase(), id);
    const infoFilePath = path.join(objectFolder, "info.json");

    if (fs.existsSync(infoFilePath)) {
      const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));
      if (infoData.fileName) {
        const fileNameMatch = infoData.fileName.match(/_(.+)\.al$/);
        if (fileNameMatch) {
          this.description = fileNameMatch[1].replace(/_/g, " ");
        }
      }
    } else {
      // No info file found
      this.description = "No info file found";
      this.iconPath = new vscode.ThemeIcon("warning");
      this.tooltip = `No info file found for ${type} ${id}. You can delete this reference if needed.`;
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
 * Tree item for referenced objects group
 */
class ReferencedObjectsGroup extends TreeItem {
  constructor(objects) {
    super("Referenced Objects", vscode.TreeItemCollapsibleState.Collapsed);
    this.objects = objects;
    this.contextValue = "referencedObjectsGroup";
    this.iconPath = new vscode.ThemeIcon("references");

    // Set a unique ID so we can remember expanded state
    this.id = `refObjectsGroup-${this.objects.length}`;
  }

  getChildren() {
    return this.objects;
  }
}

/**
 * Tree item for documentation references
 */
class DocumentationRefsItem extends TreeItem {
  constructor(docRefs, filePath) {
    super("Documentation References", vscode.TreeItemCollapsibleState.Expanded);
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.contextValue = "documentationRefs";
    this.iconPath = new vscode.ThemeIcon("book");

    // Count distinct documentation IDs
    this.distinctIds = [...new Set(docRefs.map((ref) => ref.id))];

    // Count distinct task IDs (if task ID is present)
    this.distinctTaskIds = [
      ...new Set(
        docRefs
          .filter((ref) => ref.taskId && ref.taskId.trim().length > 0)
          .map((ref) => ref.taskId)
      ),
    ];

    // Set a unique ID so we can remember expanded state
    this.id = `docRefs-${filePath}`;
  }

  getChildren() {
    // If only one type of documentation ID or just a few references, return flat list
    if (this.distinctIds.length <= 1 && this.docRefs.length <= 3) {
      return this.docRefs.map((ref) => {
        return new DocumentationRefItem(ref, this.filePath);
      });
    }

    // If we have task IDs, group by task ID first
    if (this.distinctTaskIds.length > 0) {
      // Create an array to hold all groups
      const groups = [];

      // Group references by task ID
      this.distinctTaskIds.forEach((taskId) => {
        const refsWithTaskId = this.docRefs.filter(
          (ref) => ref.taskId === taskId
        );
        if (refsWithTaskId.length > 0) {
          groups.push(
            new DocumentationRefTaskGroupItem(
              taskId,
              refsWithTaskId,
              this.filePath
            )
          );
        }
      });

      // Add references without task ID under regular documentation ID groups
      const refsWithoutTaskId = this.docRefs.filter(
        (ref) => !ref.taskId || ref.taskId.trim().length === 0
      );
      if (refsWithoutTaskId.length > 0) {
        const distinctIdsWithoutTask = [
          ...new Set(refsWithoutTaskId.map((ref) => ref.id)),
        ];

        distinctIdsWithoutTask.forEach((id) => {
          const refsForId = refsWithoutTaskId.filter((ref) => ref.id === id);
          groups.push(
            new DocumentationRefGroupItem(id, refsForId, this.filePath)
          );
        });
      }

      return groups;
    }

    // Otherwise, group by documentation ID
    return this.distinctIds.map((id) => {
      const refsForId = this.docRefs.filter((ref) => ref.id === id);
      return new DocumentationRefGroupItem(id, refsForId, this.filePath);
    });
  }
}

/**
 * Tree item for a group of documentation references with the same ID
 */
class DocumentationRefGroupItem extends TreeItem {
  constructor(id, docRefs, filePath) {
    // Find the first reference to get description info
    const firstRef = docRefs[0];
    const description = firstRef ? firstRef.description : "";

    // Only auto-expand if not too many references
    const shouldStartExpanded = docRefs.length <= 8;

    super(
      id,
      shouldStartExpanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    this.description = `${description} (${docRefs.length} references)`;
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.contextValue = "documentationRefGroup";
    this.iconPath = new vscode.ThemeIcon("symbol-folder");

    // Set a unique ID so we can remember expanded state
    this.id = `docRefGroup-${filePath}-${id}`;

    // When a docRef in this group has a URL, expose it for context menu
    const refWithUrl = docRefs.find((ref) => ref.url);
    if (refWithUrl && refWithUrl.url) {
      this.docUrl = refWithUrl.url;
    }
  }

  getChildren() {
    return this.docRefs.map((ref) => {
      return new DocumentationRefItem(ref, this.filePath);
    });
  }
}

/**
 * Tree item for a group of documentation references with the same task ID
 */
class DocumentationRefTaskGroupItem extends TreeItem {
  constructor(taskId, docRefs, filePath) {
    // Only auto-expand if not too many references
    const shouldStartExpanded = docRefs.length <= 12;

    // Use TreeItemLabel with highlights
    const labelObject = {
      label: taskId,
      highlights: [[0, taskId.length]], // Highlight the entire label
    };

    // Use the task ID as the label with appropriate initial state
    super(
      labelObject,
      shouldStartExpanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    // Count references for the description
    this.description = `(${docRefs.length} references)`;
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.contextValue = "documentationRefTaskGroup";

    // Use a different icon for task groups
    this.iconPath = new vscode.ThemeIcon("tasklist");

    // Set a unique ID so we can remember expanded state
    this.id = `docRefTaskGroup-${filePath}-${taskId}`;
  }

  getChildren() {
    // Group by document ID within task ID
    const distinctDocIds = [...new Set(this.docRefs.map((ref) => ref.id))];

    if (distinctDocIds.length === 1) {
      // If only one doc ID in this task group, return the references directly
      return this.docRefs.map(
        (ref) => new DocumentationRefItem(ref, this.filePath)
      );
    } else {
      // If multiple doc IDs, group by doc ID first
      return distinctDocIds.map((id) => {
        const refsForId = this.docRefs.filter((ref) => ref.id === id);
        return new DocumentationRefGroupItem(id, refsForId, this.filePath);
      });
    }
  }
}

/**
 * Tree item for a single documentation reference
 */
class DocumentationRefItem extends TreeItem {
  constructor(docRef, filePath) {
    // Use the context (line content) as the label, limited to 500 chars
    let contextText = docRef.context || "";

    // Remove the documentation ID and task ID from the displayed content
    const idWithTaskRegex = new RegExp(
      `${docRef.id}${docRef.taskId || ""}`,
      "g"
    );
    contextText = contextText.replace(idWithTaskRegex, "").trim();

    // As fallback, just remove the ID if the above didn't work
    const idRegex = new RegExp(docRef.id, "g");
    contextText = contextText.replace(idRegex, "").trim();

    // Handle any double spaces that might be left after removing the ID
    contextText = contextText.replace(/\s+/g, " ").trim();

    const label =
      contextText.length > 500
        ? contextText.substring(0, 499) + "..."
        : contextText;

    super(label, vscode.TreeItemCollapsibleState.None);
    this.docRef = docRef;
    this.filePath = filePath;

    // Show ID, task ID, and line number in the description
    let description = docRef.taskId
      ? `${docRef.id}${docRef.taskId} (line ${docRef.lineNumber})`
      : `${docRef.id} (line ${docRef.lineNumber})`;

    // Add user description if available
    if (docRef.userDescription) {
      description = `${description} - ${docRef.userDescription}`;
    }

    this.description = description;

    // Set context value based on status
    if (docRef.notImplemented) {
      this.contextValue = "documentationRefNotImplemented";
    } else if (docRef.done) {
      this.contextValue = "documentationRefDone";
    } else {
      this.contextValue = "documentationRef";
    }

    // Set icon based on status
    if (docRef.notImplemented) {
      this.iconPath = new vscode.ThemeIcon("circle-slash");
    } else if (docRef.done) {
      this.iconPath = new vscode.ThemeIcon("check");
    } else {
      this.iconPath = new vscode.ThemeIcon("book");
    }

    // Command to jump to the line
    this.command = {
      command: "bc-al-upgradeassistant.openDocumentationReference",
      title: "Open Reference Location",
      arguments: [filePath, docRef.lineNumber],
    };

    // Include the context in the tooltip for more information
    let tooltipText = docRef.taskId
      ? `${docRef.id}${docRef.taskId}: ${docRef.description}\n\nLine: ${docRef.lineNumber}`
      : `${docRef.id}: ${docRef.description}\n\nLine: ${docRef.lineNumber}`;

    // Add user description to tooltip if available
    if (docRef.userDescription) {
      tooltipText += `\n\nUser Note: ${docRef.userDescription}`;
    }

    if (docRef.userId) {
      tooltipText += `\n\nLast modified by: ${docRef.userId}`;
      if (docRef.lastModified) {
        tooltipText += ` on ${new Date(docRef.lastModified).toLocaleString()}`;
      }
    }

    tooltipText += `\n\nClick to open file at reference location\nRight-click for more options`;
    this.tooltip = tooltipText;

    // Create separate properties instead of arrays for arguments
    this.filePath = filePath;
    this.docId = docRef.id;
    this.lineNumber = docRef.lineNumber;
    this.docUrl = docRef.url || "";
    this.taskId = docRef.taskId || "";
  }
}

// Add new class for enhanced migration files item
class EnhancedMigrationFilesItem extends TreeItem {
  constructor(files, migrationFileRefs) {
    super(
      "Referenced Migration Files",
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.files = files;
    this.migrationFileRefs = migrationFileRefs;
    this.contextValue = "migrationFiles";
    this.iconPath = new vscode.ThemeIcon("references");

    // Use unique ID for state persistence that includes file info
    const fileHashes = files.map((f) => path.basename(f)).join("-");
    this.id = `enhancedMigFiles-${fileHashes}`;
  }

  getChildren() {
    const items = [];

    this.files.forEach((file) => {
      const fileRefs = this.migrationFileRefs.find((r) => r.file === file);
      const fileItem = new MigrationFileItem(file, fileRefs?.refs || []);
      items.push(fileItem);
    });

    return items;
  }
}

// Add new class for individual migration file items
class MigrationFileItem extends TreeItem {
  constructor(file, docRefs) {
    super(
      path.basename(file),
      docRefs.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.filePath = file;
    this.docRefs = docRefs;
    this.contextValue = "migrationFile";
    this.iconPath = new vscode.ThemeIcon("file");

    // Unique ID for state persistence that includes file path and refs count
    this.id = `migFile-${path.basename(file)}-${docRefs.length}`;

    // Command to open file - ensure we're passing the full file path
    this.command = {
      command: "bc-al-upgradeassistant.openMigrationFile",
      title: "Open Migration File",
      arguments: [file],
    };

    // Add a tooltip that shows the full path
    this.tooltip = `${file}\n\nClick to open file or use context menu`;
  }

  getChildren() {
    if (this.docRefs && this.docRefs.length > 0) {
      return this.docRefs.map(
        (ref) => new DocumentationRefItem(ref, this.filePath)
      );
    }
    return [];
  }
}

module.exports = FileReferenceProvider;
