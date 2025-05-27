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
    this.filterMode = 'all'; // Initialize filterMode

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
    this.uncheckedDecorationType = vscode.window.createTextEditorDecorationType(
      {
        gutterIconPath: path.join(
          __dirname,
          "..",
          "..",
          "media",
          "unchecked.svg"
        ),
        gutterIconSize: "100%",
        fontWeight: "normal",
        color: new vscode.ThemeColor("editorGutter.modifiedBackground"),
        isWholeLine: true,
      }
    );

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
      let indexFolder = this._findIndexFolder();
      if (!indexFolder) {
        try {
          // Determine where to create the index folder
          let basePath;

          // First try to use configured path
          this.configManager = require("../utils/configManager");
          const upgradedObjectFolders = this.configManager.getConfigValue(
            "upgradedObjectFolders",
            null
          );

          if (upgradedObjectFolders && upgradedObjectFolders.basePath) {
            basePath = upgradedObjectFolders.basePath;
          } else if (
            vscode.workspace.workspaceFolders &&
            vscode.workspace.workspaceFolders.length > 0
          ) {
            // Default to first workspace folder
            basePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
          } else {
            return [
              new TreeItem(
                "Cannot create index folder - no workspace open",
                vscode.TreeItemCollapsibleState.None
              ),
            ];
          }

          // Create the index folder
          indexFolder = path.join(basePath, ".index");
          fs.mkdirSync(indexFolder, { recursive: true });

          // Notify the user
          vscode.window.showInformationMessage(
            `Created index folder at ${indexFolder}`
          );
          console.log(`Created index folder at ${indexFolder}`);
        } catch (error) {
          console.error("Error creating index folder:", error);
          return [
            new TreeItem(
              `Error creating index folder: ${error.message}`,
              vscode.TreeItemCollapsibleState.None
            ),
          ];
        }
      }

      // Look for reference file in the index folder
      const fileName = path.basename(filePath);
      const referenceFileName = fileName.replace(/\.txt$/, ".json");
      const referenceFilePath = path.join(indexFolder, referenceFileName);

      const result = [];
      let referencedObjects = [];

      // Read file content and look for documentation IDs
      const fileContent = fs.readFileSync(filePath, "utf8");
      const documentationRefs = this._findDocumentationReferences(
        fileContent,
        filePath
      );
      const filteredDocRefs = this._applyFilter(documentationRefs);

      // Check for reference file
      if (fs.existsSync(referenceFilePath)) {
        try {
          const referenceData = JSON.parse(
            fs.readFileSync(referenceFilePath, "utf8")
          );

          if (referenceData.referencedWorkingObjects?.length > 0) {
            referencedObjects = referenceData.referencedWorkingObjects.map(
              (ref) => {
                return new ReferencedObjectItem(
                  ref.type,
                  ref.number.toString(),
                  indexFolder
                );
              }
            );
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

      // Always add Referenced Objects group, even if empty
      result.push(new ReferencedObjectsGroup(referencedObjects));

      // Add documentation references after referenced objects
      if (filteredDocRefs.length > 0) {
        result.push(new DocumentationRefsItem(filteredDocRefs, filePath));
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
            const filteredDocRefsForMig = this._applyFilter(docRefs);
            if (filteredDocRefsForMig.length > 0) {
              migrationFileRefs.push({
                file: migFile,
                refs: filteredDocRefsForMig,
              });
            }
          }
        }

        // Create migration files node with documentation references
        if (migrationFileRefs.length > 0) {
            result.push(
              new EnhancedMigrationFilesItem(migrationFiles, migrationFileRefs)
            );
        }

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
   * @param {string} [userDescription] Optional user description when toggling to not implemented
   * @returns {boolean} New "not implemented" state
   */
  toggleDocumentationReferenceNotImplemented(
    filePath,
    id,
    lineNumber,
    userDescription
  ) {
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

          // If toggling TO not implemented and we have a description, add it
          if (ref.notImplemented && userDescription !== undefined) {
            ref.userDescription = userDescription;
          }

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
          // Add new entry (initially not implemented)
          ref = {
            id,
            lineNumber,
            done: false,
            notImplemented: true,
            userDescription: userDescription || "",
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

  /**
   * Toggle the "done" state of all documentation references in a procedure
   * @param {string} filePath File path
   * @param {number} startLine Procedure start line
   * @param {number} endLine Procedure end line
   * @returns {boolean} Operation success
   */
  toggleProcedureReferencesDone(filePath, startLine, endLine) {
    try {
      // Find all documentation references in this procedure
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the procedure's range
      const refsInProcedure = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInProcedure.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const doneCount = refsInProcedure.filter((ref) => ref.done).length;
      const targetState = doneCount <= refsInProcedure.length / 2;

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Toggle state for each reference
      for (const ref of refsInProcedure) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update state
          refData.done = targetState;
          // If marked as done, it can't be not implemented
          if (targetState && refData.notImplemented) {
            refData.notImplemented = false;
          }
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            done: targetState,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      // Update decorations
      this.updateDecorations();

      return true;
    } catch (error) {
      console.error("Error toggling procedure references state:", error);
      return false;
    }
  }

  /**
   * Toggle the "not implemented" state of all documentation references in a procedure
   * @param {string} filePath File path
   * @param {number} startLine Procedure start line
   * @param {number} endLine Procedure end line
   * @param {string} [userDescription] Optional user description when toggling to not implemented
   * @returns {boolean} Operation success
   */
  toggleProcedureReferencesNotImplemented(
    filePath,
    startLine,
    endLine,
    userDescription
  ) {
    try {
      // Find all documentation references in this procedure
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the procedure's range
      const refsInProcedure = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInProcedure.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const notImplCount = refsInProcedure.filter(
        (ref) => ref.notImplemented
      ).length;
      const targetState = notImplCount <= refsInProcedure.length / 2;

      // If not toggling to not implemented state, we don't need a description
      if (!targetState) {
        return this._toggleGroupReferencesNotImplemented(
          filePath,
          refsInProcedure,
          targetState
        );
      }

      // Only apply the description if we're toggling TO not implemented
      return this._toggleGroupReferencesNotImplemented(
        filePath,
        refsInProcedure,
        targetState,
        userDescription
      );
    } catch (error) {
      console.error(
        "Error toggling procedure references not implemented state:",
        error
      );
      return false;
    }
  }

  /**
   * Toggle the "not implemented" state of all documentation references in a trigger
   * @param {string} filePath File path
   * @param {number} startLine Trigger start line
   * @param {number} endLine Trigger end line
   * @param {string} [userDescription] Optional user description when toggling to not implemented
   * @returns {boolean} Operation success
   */
  toggleTriggerReferencesNotImplemented(
    filePath,
    startLine,
    endLine,
    userDescription
  ) {
    try {
      // Find all documentation references in this trigger
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the trigger's range
      const refsInTrigger = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInTrigger.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const notImplCount = refsInTrigger.filter(
        (ref) => ref.notImplemented
      ).length;
      const targetState = notImplCount <= refsInTrigger.length / 2;

      // If not toggling to not implemented state, we don't need a description
      if (!targetState) {
        return this._toggleGroupReferencesNotImplemented(
          filePath,
          refsInTrigger,
          targetState
        );
      }

      // Only apply the description if we're toggling TO not implemented
      return this._toggleGroupReferencesNotImplemented(
        filePath,
        refsInTrigger,
        targetState,
        userDescription
      );
    } catch (error) {
      console.error(
        "Error toggling trigger references not implemented state:",
        error
      );
      return false;
    }
  }

  /**
   * Toggle the "done" state of all documentation references in a trigger
   * @param {string} filePath File path
   * @param {number} startLine Trigger start line
   * @param {number} endLine Trigger end line
   * @returns {boolean} Operation success
   */
  toggleTriggerReferencesDone(filePath, startLine, endLine) {
    try {
      // Find all documentation references in this trigger
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the trigger's range
      const refsInTrigger = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInTrigger.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const doneCount = refsInTrigger.filter((ref) => ref.done).length;
      const targetState = doneCount <= refsInTrigger.length / 2;

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Toggle state for each reference
      for (const ref of refsInTrigger) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update state
          refData.done = targetState;
          // If marked as done, it can't be not implemented
          if (targetState && refData.notImplemented) {
            refData.notImplemented = false;
          }
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            done: targetState,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      // Update decorations
      this.updateDecorations();

      return true;
    } catch (error) {
      console.error("Error toggling trigger references state:", error);
      return false;
    }
  }

  /**
   * Set description for all documentation references in a procedure
   * @param {string} filePath File path
   * @param {number} startLine Procedure start line
   * @param {number} endLine Procedure end line
   * @param {string} description User-provided description
   * @returns {boolean} Success status
   */
  setProcedureReferencesDescription(filePath, startLine, endLine, description) {
    try {
      // Find all documentation references in this procedure
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the procedure's range
      const refsInProcedure = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInProcedure.length === 0) {
        return false;
      }

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Set description for each reference
      for (const ref of refsInProcedure) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update description
          refData.userDescription = description;
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            userDescription: description,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      return true;
    } catch (error) {
      console.error("Error setting procedure references description:", error);
      return false;
    }
  }

  /**
   * Set description for all documentation references in a trigger
   * @param {string} filePath File path
   * @param {number} startLine Trigger start line
   * @param {number} endLine Trigger end line
   * @param {string} description User-provided description
   * @returns {boolean} Success status
   */
  setTriggerReferencesDescription(filePath, startLine, endLine, description) {
    try {
      // Find all documentation references in this trigger
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the trigger's range
      const refsInTrigger = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInTrigger.length === 0) {
        return false;
      }

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Set description for each reference
      for (const ref of refsInTrigger) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update description
          refData.userDescription = description;
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            userDescription: description,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      return true;
    } catch (error) {
      console.error("Error setting trigger references description:", error);
      return false;
    }
  }

  /**
   * Toggle the "done" state of all documentation references in an action
   * @param {string} filePath File path
   * @param {number} startLine Action start line
   * @param {number} endLine Action end line
   * @returns {boolean} Operation success
   */
  toggleActionReferencesDone(filePath, startLine, endLine) {
    try {
      // Find all documentation references in this action
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the action's range
      const refsInAction = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInAction.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const doneCount = refsInAction.filter((ref) => ref.done).length;
      const targetState = doneCount <= refsInAction.length / 2;

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Toggle state for each reference
      for (const ref of refsInAction) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update state
          refData.done = targetState;
          // If marked as done, it can't be not implemented
          if (targetState && refData.notImplemented) {
            refData.notImplemented = false;
          }
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            done: targetState,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      // Update decorations
      this.updateDecorations();

      return true;
    } catch (error) {
      console.error("Error toggling action references state:", error);
      return false;
    }
  }

  /**
   * Toggle the "not implemented" state of all documentation references in an action
   * @param {string} filePath File path
   * @param {number} startLine Action start line
   * @param {number} endLine Action end line
   * @param {string} [userDescription] Optional user description when toggling to not implemented
   * @returns {boolean} Operation success
   */
  toggleActionReferencesNotImplemented(
    filePath,
    startLine,
    endLine,
    userDescription
  ) {
    try {
      // Find all documentation references in this action
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the action's range
      const refsInAction = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInAction.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const notImplCount = refsInAction.filter(
        (ref) => ref.notImplemented
      ).length;
      const targetState = notImplCount <= refsInAction.length / 2;

      // If not toggling to not implemented state, we don't need a description
      if (!targetState) {
        return this._toggleGroupReferencesNotImplemented(
          filePath,
          refsInAction,
          targetState
        );
      }

      // Only apply the description if we're toggling TO not implemented
      return this._toggleGroupReferencesNotImplemented(
        filePath,
        refsInAction,
        targetState,
        userDescription
      );
    } catch (error) {
      console.error(
        "Error toggling action references not implemented state:",
        error
      );
      return false;
    }
  }

  /**
   * Set description for all documentation references in an action
   * @param {string} filePath File path
   * @param {number} startLine Action start line
   * @param {number} endLine Action end line
   * @param {string} description User-provided description
   * @returns {boolean} Success status
   */
  setActionReferencesDescription(filePath, startLine, endLine, description) {
    try {
      // Find all documentation references in this action
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the action's range
      const refsInAction = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInAction.length === 0) {
        return false;
      }

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Set description for each reference
      for (const ref of refsInAction) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update description
          refData.userDescription = description;
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            userDescription: description,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      return true;
    } catch (error) {
      console.error("Error setting action references description:", error);
      return false;
    }
  }

  /**
   * Toggle the "done" state of all documentation references in a field
   * @param {string} filePath File path
   * @param {number} startLine Field start line
   * @param {number} endLine Field end line
   * @returns {boolean} Operation success
   */
  toggleFieldReferencesDone(filePath, startLine, endLine) {
    try {
      // Find all documentation references in this field
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the field's range
      const refsInField = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInField.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const doneCount = refsInField.filter((ref) => ref.done).length;
      const targetState = doneCount <= refsInField.length / 2;

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Toggle state for each reference
      for (const ref of refsInField) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update state
          refData.done = targetState;
          // If marked as done, it can't be not implemented
          if (targetState && refData.notImplemented) {
            refData.notImplemented = false;
          }
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            done: targetState,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      // Update decorations
      this.updateDecorations();

      return true;
    } catch (error) {
      console.error("Error toggling field references state:", error);
      return false;
    }
  }

  /**
   * Toggle the "not implemented" state of all documentation references in a field
   * @param {string} filePath File path
   * @param {number} startLine Field start line
   * @param {number} endLine Field end line
   * @param {string} [userDescription] Optional user description when toggling to not implemented
   * @returns {boolean} Operation success
   */
  toggleFieldReferencesNotImplemented(
    filePath,
    startLine,
    endLine,
    userDescription
  ) {
    try {
      // Find all documentation references in this field
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the field's range
      const refsInField = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInField.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const notImplCount = refsInField.filter(
        (ref) => ref.notImplemented
      ).length;
      const targetState = notImplCount <= refsInField.length / 2;

      // If not toggling to not implemented state, we don't need a description
      if (!targetState) {
        return this._toggleGroupReferencesNotImplemented(
          filePath,
          refsInField,
          targetState
        );
      }

      // Only apply the description if we're toggling TO not implemented
      return this._toggleGroupReferencesNotImplemented(
        filePath,
        refsInField,
        targetState,
        userDescription
      );
    } catch (error) {
      console.error(
        "Error toggling field references not implemented state:",
        error
      );
      return false;
    }
  }

  /**
   * Set description for all documentation references in a field
   * @param {string} filePath File path
   * @param {number} startLine Field start line
   * @param {number} endLine Field end line
   * @param {string} description User-provided description
   * @returns {boolean} Success status
   */
  setFieldReferencesDescription(filePath, startLine, endLine, description) {
    try {
      // Find all documentation references in this field
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references within the field's range
      const refsInField = docRefs.filter(
        (ref) => ref.lineNumber >= startLine && ref.lineNumber <= endLine
      );

      if (refsInField.length === 0) {
        return false;
      }

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Set description for each reference
      for (const ref of refsInField) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update description
          refData.userDescription = description;
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            userDescription: description,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      return true;
    } catch (error) {
      console.error("Error setting field references description:", error);
      return false;
    }
  }

  /**
   * Helper method to toggle not implemented state for a group of references
   * @param {string} filePath File path
   * @param {Array} refs References to update
   * @param {boolean} targetState Target state
   * @param {string} [userDescription] Optional user description
   * @returns {boolean} Success status
   * @private
   */
  _toggleGroupReferencesNotImplemented(
    filePath,
    refs,
    targetState,
    userDescription
  ) {
    try {
      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Toggle state for each reference
      for (const ref of refs) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update state
          refData.notImplemented = targetState;

          // If toggling TO not implemented and we have a description, set it
          if (targetState && userDescription !== undefined) {
            refData.userDescription = userDescription;
          }

          // If marked as not implemented, it can't be done
          if (targetState && refData.done) {
            refData.done = false;
          }

          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            done: false,
            notImplemented: targetState,
            userDescription:
              targetState && userDescription ? userDescription : "",
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      // Update decorations
      this.updateDecorations();

      return true;
    } catch (error) {
      console.error("Error in _toggleGroupReferencesNotImplemented:", error);
      return false;
    }
  }

  /**
   * Toggle the "done" state of all documentation references with the same task ID
   * @param {string} filePath File path
   * @param {string} taskId Task ID
   * @returns {boolean} Operation success
   */
  toggleTaskReferenceDone(filePath, taskId) {
    try {
      // Find all documentation references in this file
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references with this task ID
      const refsWithTaskId = docRefs.filter((ref) => ref.taskId === taskId);

      if (refsWithTaskId.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const doneCount = refsWithTaskId.filter((ref) => ref.done).length;
      const targetState = doneCount <= refsWithTaskId.length / 2;

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Toggle state for each reference
      for (const ref of refsWithTaskId) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update state
          refData.done = targetState;
          // If marked as done, it can't be not implemented
          if (targetState && refData.notImplemented) {
            refData.notImplemented = false;
          }
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            done: targetState,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      // Update decorations
      this.updateDecorations();

      return true;
    } catch (error) {
      console.error("Error toggling task references state:", error);
      return false;
    }
  }

  /**
   * Toggle the "not implemented" state of all documentation references with the same task ID
   * @param {string} filePath File path
   * @param {string} taskId Task ID
   * @param {string} [userDescription] Optional user description when toggling to not implemented
   * @returns {boolean} Operation success
   */
  toggleTaskReferenceNotImplemented(filePath, taskId, userDescription) {
    try {
      // Find all documentation references in this file
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references with this task ID
      const refsWithTaskId = docRefs.filter((ref) => ref.taskId === taskId);

      if (refsWithTaskId.length === 0) {
        return false;
      }

      // Determine the target state (opposite of majority current state)
      const notImplCount = refsWithTaskId.filter(
        (ref) => ref.notImplemented
      ).length;
      const targetState = notImplCount <= refsWithTaskId.length / 2;

      // If not toggling to not implemented state, we don't need a description
      if (!targetState) {
        return this._toggleGroupReferencesNotImplemented(
          filePath,
          refsWithTaskId,
          targetState
        );
      }

      // Only apply the description if we're toggling TO not implemented
      return this._toggleGroupReferencesNotImplemented(
        filePath,
        refsWithTaskId,
        targetState,
        userDescription
      );
    } catch (error) {
      console.error(
        "Error toggling task references not implemented state:",
        error
      );
      return false;
    }
  }

  /**
   * Set description for all documentation references with the same task ID
   * @param {string} filePath File path
   * @param {string} taskId Task ID
   * @param {string} description User-provided description
   * @returns {boolean} Success status
   */
  setTaskReferenceDescription(filePath, taskId, description) {
    try {
      // Find all documentation references in this file
      const fileContent = fs.readFileSync(filePath, "utf8");
      const docRefs = this._findDocumentationReferences(fileContent, filePath);

      // Filter to references with this task ID
      const refsWithTaskId = docRefs.filter((ref) => ref.taskId === taskId);

      if (refsWithTaskId.length === 0) {
        return false;
      }

      // Get storage file and data
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
        storageData[fileKey] = { references: [] };
      }

      // Set description for each reference
      for (const ref of refsWithTaskId) {
        // Find existing reference or add new one
        let refData = storageData[fileKey].references.find(
          (r) => r.id === ref.id && r.lineNumber === ref.lineNumber
        );

        if (refData) {
          // Update description
          refData.userDescription = description;
          // Silently add/update userId
          if (userId) {
            refData.userId = userId;
            refData.lastModified = new Date().toISOString();
          }
        } else {
          // Add new entry
          refData = {
            id: ref.id,
            lineNumber: ref.lineNumber,
            userDescription: description,
            userId: userId || undefined,
            lastModified: new Date().toISOString(),
          };
          storageData[fileKey].references.push(refData);
        }
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      return true;
    } catch (error) {
      console.error("Error setting task references description:", error);
      return false;
    }
  }

  _applyFilter(docRefs) {
    if (!docRefs || docRefs.length === 0) return [];
    if (this.filterMode === 'all') {
        return docRefs;
    }
    return docRefs.filter(ref => {
        if (!ref) return false;
        const isDone = ref.done === true && (ref.notImplemented === false || ref.notImplemented === undefined);
        const isNotImplemented = ref.notImplemented === true;

        if (this.filterMode === 'done') {
            return isDone;
        }
        if (this.filterMode === 'notDone') {
            return !isDone && !isNotImplemented;
        }
        return true; // Default for 'all' or unexpected filterMode
    });
  }

  setFilterMode(mode) {
    if (['all', 'done', 'notDone'].includes(mode)) {
      this.filterMode = mode;
      this.refresh(); // Triggers _onDidChangeTreeData.fire(null)
    } else {
      console.warn(`Invalid filter mode: ${mode}`);
    }
  }

  /**
   * Set expanded state for an item (for webview compatibility)
   */
  setItemExpandedState(itemId, expanded) {
    // This is handled by the tree view automatically in VS Code
    // For webview, we don't need to persist this state
    // The webview will handle its own expand/collapse state
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
        this.uncheckedDecorationType,
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
    this.uncheckedDecorationType.dispose();
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
    let objectName = "";

    // Try to get object name
    const objectFolder = path.join(indexFolder, type.toLowerCase(), id);
    const infoFilePath = path.join(objectFolder, "info.json");

    if (fs.existsSync(infoFilePath)) {
      try {
        const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));
        if (infoData.originalPath) {
          // Extract file name without extension
          const fileName = path.basename(infoData.originalPath, ".al");

          // For better naming, we need to determine object type pattern
          if (fileName.includes(type.toLowerCase())) {
            // Remove type prefix and any trailing dots or underscores
            objectName = fileName.replace(
              new RegExp(`^${type.toLowerCase()}\\.`),
              ""
            );
          } else {
            // Just use the filename directly
            objectName = fileName;
          }

          // Clean up name - replace underscores with spaces if configured to do so
          objectName = objectName.replace(/^[0-9]+_/, ""); // Remove leading numbers/underscores

          // Set the description to the object name
          this.description = objectName;
          // Also add it to the tooltip
          this.tooltip = `${type} ${id}: ${objectName}\n\nClick to open object`;
        }
      } catch (error) {
        console.error(`Error reading info file for ${type} ${id}:`, error);
        this.description = "Error reading object info";
        this.iconPath = new vscode.ThemeIcon("warning");
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

    // Parse content for procedures, triggers, actions, and fields
    const content = fs.readFileSync(filePath, "utf8");
    this.procedures = documentationHelper.findProcedures(content);
    this.triggers = documentationHelper.findTriggers(content);
    this.actions = documentationHelper.findActions(content);
    this.fields = documentationHelper.findFields(content);

    // Filter items to only include those with documentation references
    this.proceduresWithRefs = this._filterItemsWithDocRefs(
      this.procedures,
      docRefs
    );
    this.triggersWithRefs = this._filterItemsWithDocRefs(
      this.triggers,
      docRefs
    );
    this.actionsWithRefs = this._filterItemsWithDocRefs(this.actions, docRefs);
    this.fieldsWithRefs = this._filterItemsWithDocRefs(this.fields, docRefs);

    // Set a unique ID so we can remember expanded state
    this.id = `docRefs-${filePath}`;
  }

  /**
   * Filter items to only include those that contain documentation references
   * @param {Array<{startLine: number, endLine: number}>} items Items to filter
   * @param {Array<{lineNumber: number}>} docRefs Documentation references
   * @returns {Array} Filtered items
   */
  _filterItemsWithDocRefs(items, docRefs) {
    if (!items || items.length === 0) return [];

    return items.filter((item) => {
      if (!item.startLine || !item.endLine) return false;

      // Check if any docRef falls within this item's range
      return docRefs.some((ref) => {
        const line = ref.lineNumber;
        return line >= item.startLine && line <= item.endLine;
      });
    });
  }

  getChildren() {
    // Create an array to hold all groups
    const groups = [];

    // If only one type of documentation ID or just a few references, return flat list
    // This needs to use this.docRefs which are already filtered.
    if (this.docRefs.length === 0) return []; // No references, no children

    if (this.distinctIds.length <= 1 && this.docRefs.length <= 3) {
      return this.docRefs.map((ref) => {
        return new DocumentationRefItem(ref, this.filePath);
      });
    }

    // Procedures
    const proceduresToShow = this.proceduresWithRefs.filter(proc =>
        this.docRefs.some(ref => ref.lineNumber >= proc.startLine && ref.lineNumber <= proc.endLine)
    );
    if (proceduresToShow.length > 0) {
        groups.push(new ProceduresGroupItem(proceduresToShow, this.docRefs, this.filePath));
    }

    // Triggers
    const triggersToShow = this.triggersWithRefs.filter(trigger =>
        this.docRefs.some(ref => ref.lineNumber >= trigger.startLine && ref.lineNumber <= trigger.endLine)
    );
    if (triggersToShow.length > 0) {
        groups.push(new TriggersGroupItem(triggersToShow, this.docRefs, this.filePath));
    }

    // Actions
    const actionsToShow = this.actionsWithRefs.filter(action =>
        this.docRefs.some(ref => ref.lineNumber >= action.startLine && ref.lineNumber <= action.endLine)
    );
    if (actionsToShow.length > 0) {
        groups.push(new ActionsGroupItem(actionsToShow, this.docRefs, this.filePath));
    }

    // Fields
    const fieldsToShow = this.fieldsWithRefs.filter(field =>
        this.docRefs.some(ref => ref.lineNumber >= field.startLine && ref.lineNumber <= field.endLine)
    );
    if (fieldsToShow.length > 0) {
        groups.push(new FieldsGroupItem(fieldsToShow, this.docRefs, this.filePath));
    }


    // If we have task IDs, group by task ID
    if (this.distinctTaskIds.length > 0) {
      // Group references by task ID
      this.distinctTaskIds.forEach((taskId) => {
        const refsWithTaskId = this.docRefs.filter( // this.docRefs is already filtered
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
      const refsWithoutTaskId = this.docRefs.filter( // this.docRefs is already filtered
        (ref) => !ref.taskId || ref.taskId.trim().length === 0
      );
      if (refsWithoutTaskId.length > 0) {
        const distinctIdsWithoutTask = [
          ...new Set(refsWithoutTaskId.map((ref) => ref.id)),
        ];

        distinctIdsWithoutTask.forEach((id) => {
          const refsForId = refsWithoutTaskId.filter((ref) => ref.id === id); // refsWithoutTaskId is from filtered this.docRefs
          if (refsForId.length > 0) { // Ensure group is not empty
            groups.push(
              new DocumentationRefGroupItem(id, refsForId, this.filePath)
            );
          }
        });
      }

      return groups;
    }

    // Otherwise, group by documentation ID
    return this.distinctIds.map((id) => {
      const refsForId = this.docRefs.filter((ref) => ref.id === id); // this.docRefs is already filtered
      // We must ensure that we only return groups that will have children.
      // However, DocumentationRefGroupItem itself doesn't filter its children further based on content,
      // it just displays all refsForId. So, if refsForId is not empty, the group is valid.
      if (refsForId.length > 0) {
        return new DocumentationRefGroupItem(id, refsForId, this.filePath);
      }
      return null; // Should be filtered out by a subsequent .filter(item => item !== null) if necessary
    }).filter(item => item !== null); // Filter out null groups
  }
}

/**
 * Base class for code element groupings (procedures, triggers, etc.)
 */
class CodeElementGroupItem extends TreeItem {
  constructor(label, elements, docRefs, filePath, iconName = "symbol-method") {
    // Only auto-expand if not too many elements
    const shouldStartExpanded = elements.length <= 8;

    super(
      label,
      shouldStartExpanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    this.elements = elements;
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.description = `(${elements.length} items)`;
    this.contextValue = "codeElementGroup";
    this.iconPath = new vscode.ThemeIcon(iconName);

    // Set a unique ID so we can remember expanded state
    this.id = `codeElemGroup-${filePath}-${label}`;
  }

  /**
   * Find documentation references within this element
   * @param {Object} element The code element
   * @returns {Array} Documentation references within this element
   */
  findRefsInElement(element) {
    if (!element.startLine || !element.endLine) return [];

    return this.docRefs.filter((ref) => {
      const line = ref.lineNumber;
      return line >= element.startLine && line <= element.endLine;
    });
  }
}

/**
 * Tree item for procedures group
 */
class ProceduresGroupItem extends CodeElementGroupItem {
  constructor(procedures, docRefs, filePath) {
    super("Procedures", procedures, docRefs, filePath, "symbol-method");
  }

  getChildren() {
    return this.elements.map((proc) => {
      const refsInProc = this.findRefsInElement(proc);
      return new ProcedureItem(proc, refsInProc, this.filePath);
    });
  }
}

/**
 * Tree item for triggers group
 */
class TriggersGroupItem extends CodeElementGroupItem {
  constructor(triggers, docRefs, filePath) {
    super("Triggers", triggers, docRefs, filePath, "symbol-event");
  }

  getChildren() {
    return this.elements.map((trigger) => {
      const refsInTrigger = this.findRefsInElement(trigger);
      return new TriggerItem(trigger, refsInTrigger, this.filePath);
    });
  }
}

/**
 * Tree item for actions group
 */
class ActionsGroupItem extends CodeElementGroupItem {
  constructor(actions, docRefs, filePath) {
    super("Actions", actions, docRefs, filePath, "run");
  }

  getChildren() {
    return this.elements.map((action) => {
      const refsInAction = this.findRefsInElement(action);
      return new ActionItem(action, refsInAction, this.filePath);
    });
  }
}

/**
 * Tree item for fields group
 */
class FieldsGroupItem extends CodeElementGroupItem {
  constructor(fields, docRefs, filePath) {
    super("Fields", fields, docRefs, filePath, "symbol-field");
  }

  getChildren() {
    return this.elements.map((field) => {
      const refsInField = this.findRefsInElement(field);
      return new FieldItem(field, refsInField, this.filePath);
    });
  }
}

/**
 * Tree item for a single procedure
 */
class ProcedureItem extends TreeItem {
  constructor(procedure, docRefs, filePath) {
    // Use procedure name as label
    const isLocal = procedure.isLocal ? "LOCAL " : "";
    super(
      `${isLocal}${procedure.name}`,
      docRefs.length > 1
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.procedure = procedure;
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.description = `(line ${procedure.lineNumber})`;
    this.contextValue = "procedureItem";
    this.iconPath = new vscode.ThemeIcon("symbol-method");

    // Set a unique ID so we can remember expanded state
    this.id = `proc-${filePath}-${procedure.name}-${procedure.lineNumber}`;

    // Command to jump to the procedure
    this.command = {
      command: "bc-al-upgradeassistant.openDocumentationReference",
      title: "Open Procedure Location",
      arguments: [filePath, procedure.lineNumber],
    };

    // Include the context in the tooltip
    this.tooltip = `${procedure.context}\n\nLine: ${procedure.lineNumber}\n\nClick to open file at procedure location`;

    // Add properties for bulk operations
    this.startLine = procedure.startLine;
    this.endLine = procedure.endLine;
  }

  getChildren() {
    // If only one doc ref, we still need to show it as a child
    // so the user can interact with individual references
    return this.docRefs.map(
      (ref) => new DocumentationRefItem(ref, this.filePath)
    );
  }
}

/**
 * Tree item for a single trigger
 */
class TriggerItem extends TreeItem {
  constructor(trigger, docRefs, filePath) {
    // Use trigger name as label
    super(
      trigger.name,
      docRefs.length > 1
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.trigger = trigger;
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.description = `(line ${trigger.lineNumber})`;
    this.contextValue = "triggerItem";
    this.iconPath = new vscode.ThemeIcon("symbol-event");

    // Set a unique ID so we can remember expanded state
    this.id = `trigger-${filePath}-${trigger.name}-${trigger.lineNumber}`;

    // Command to jump to the trigger
    this.command = {
      command: "bc-al-upgradeassistant.openDocumentationReference",
      title: "Open Trigger Location",
      arguments: [filePath, trigger.lineNumber],
    };

    // Include the context in the tooltip
    this.tooltip = `${trigger.context}\n\nLine: ${trigger.lineNumber}\n\nClick to open file at trigger location`;

    // Add properties for bulk operations
    this.startLine = trigger.startLine;
    this.endLine = trigger.endLine;
  }

  getChildren() {
    // Always return all doc refs to enable individual operations
    return this.docRefs.map(
      (ref) => new DocumentationRefItem(ref, this.filePath)
    );
  }
}

/**
 * Tree item for a single action
 */
class ActionItem extends TreeItem {
  constructor(action, docRefs, filePath) {
    // Use action name as label
    super(
      action.name,
      docRefs.length > 1
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.action = action;
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.description = `(line ${action.lineNumber})`;
    this.contextValue = "actionItem";
    this.iconPath = new vscode.ThemeIcon("run");

    // Set a unique ID so we can remember expanded state
    this.id = `action-${filePath}-${action.name}-${action.lineNumber}`;

    // Command to jump to the action
    this.command = {
      command: "bc-al-upgradeassistant.openDocumentationReference",
      title: "Open Action Location",
      arguments: [filePath, action.lineNumber],
    };

    // Include the context in the tooltip
    this.tooltip = `${action.context}\n\nLine: ${action.lineNumber}\n\nClick to open file at action location`;

    // Add properties for bulk operations
    this.startLine = action.startLine;
    this.endLine = action.endLine;
  }

  getChildren() {
    // Always return all doc refs to enable individual operations
    return this.docRefs.map(
      (ref) => new DocumentationRefItem(ref, this.filePath)
    );
  }
}

/**
 * Tree item for a single field
 */
class FieldItem extends TreeItem {
  constructor(field, docRefs, filePath) {
    // Use field name as label, include ID if available
    const label = field.id ? `(${field.id}) ${field.name}` : field.name;

    super(
      label,
      docRefs.length > 1
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.field = field;
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.description = `(line ${field.lineNumber})`;
    this.contextValue = "fieldItem";
    this.iconPath = new vscode.ThemeIcon("symbol-field");

    // Set a unique ID so we can remember expanded state
    this.id = `field-${filePath}-${field.name}-${field.lineNumber}`;

    // Command to jump to the field
    this.command = {
      command: "bc-al-upgradeassistant.openDocumentationReference",
      title: "Open Field Location",
      arguments: [filePath, field.lineNumber],
    };

    // Include the context in the tooltip
    this.tooltip = `${field.context}\n\nLine: ${field.lineNumber}\n\nClick to open file at field location`;

    // Add properties for bulk operations
    this.startLine = field.startLine;
    this.endLine = field.endLine;
  }

  getChildren() {
    // Always return all doc refs to enable individual operations
    return this.docRefs.map(
      (ref) => new DocumentationRefItem(ref, this.filePath)
    );
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

    // Add taskId to allow for batch operations
    this.taskId = taskId;

    // Use a different icon for task groups
    this.iconPath = new vscode.ThemeIcon("tasklist");

    // Set a unique ID so we can remember expanded state
    this.id = `docRefTaskGroup-${filePath}-${taskId}`;

    // Add the buttons for toggle done and edit description
    this.tooltip = "Task ID group - use context menu for bulk operations";

    // Add toolbar buttons for common actions
    this.buttons = [
      {
        iconPath: new vscode.ThemeIcon("check-all"),
        tooltip: "Mark all references as done/undone",
        command: {
          command: "bc-al-upgradeassistant.toggleTaskReferenceDone",
          title: "Toggle Done Status",
          arguments: [this],
        },
      },
      {
        iconPath: new vscode.ThemeIcon("edit"),
        tooltip: "Add note to all references",
        command: {
          command: "bc-al-upgradeassistant.setTaskReferenceDescription",
          title: "Add Note",
          arguments: [this],
        },
      },
    ];
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
      this.iconPath = new vscode.ThemeIcon("circle-slash");
    } else if (docRef.done) {
      this.contextValue = "documentationRefDone";
      this.iconPath = new vscode.ThemeIcon("check");
    } else {
      this.contextValue = "documentationRef";
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
      vscode.TreeItemCollapsibleState.Expanded
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
        ? vscode.TreeItemCollapsibleState.Expanded
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
