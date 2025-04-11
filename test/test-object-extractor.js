const fs = require("fs");
const path = require("path");
const { Transform, Writable } = require("stream");

/**
 * Transform stream that splits input into C/AL objects
 */
class ObjectSplitterTransform extends Transform {
  constructor(options = {}) {
    super({
      ...options,
      objectMode: true,
      highWaterMark: 64,
    });
    this.buffer = Buffer.alloc(0);
    this.resetCurrentObject();
    this.objectCount = 0;
  }

  _transform(chunk, encoding, callback) {
    try {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      let pos = 0;
      let lineStart = 0;

      while (pos < this.buffer.length) {
        if (this.buffer[pos] === 10 || this.buffer[pos] === 13) {
          // \n or \r
          if (pos > lineStart) {
            const line = this.buffer.slice(lineStart, pos).toString("utf8");
            this._processLine(line);
          }
          // Skip \r\n
          if (
            this.buffer[pos] === 13 &&
            pos + 1 < this.buffer.length &&
            this.buffer[pos + 1] === 10
          ) {
            pos++;
          }
          lineStart = pos + 1;
        }
        pos++;
      }

      // Keep unprocessed data in buffer
      this.buffer = this.buffer.slice(lineStart);
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    if (this.buffer.length > 0) {
      this._processLine(this.buffer.toString("utf8"));
    }
    if (this.currentObject.content.length > 0) {
      this.push(this._finalizeCurrentObject());
    }
    callback();
  }

  _processLine(line) {
    const trimmedLine = line.trim();
    const isCalObject = trimmedLine.startsWith("OBJECT ");
    const isAlExtensionObject =
      /^\s*(tableextension|pageextension|reportextension|codeunitextension|enumextension)\s+/i.test(
        trimmedLine
      );

    if (isCalObject || isAlExtensionObject) {
      // Finish current object if exists
      if (this.currentObject.content.length > 0) {
        this.push(this._finalizeCurrentObject());
      }
      this._startNewObject(line, isCalObject);
    } else {
      // Only add non-object lines to content
      if (this.currentObject.content.length > 0 || trimmedLine) {
        this.currentObject.content.push(line);
      }
    }
  }

  _startNewObject(line, isCalObject) {
    this.resetCurrentObject();
    this.currentObject.content.push(line);

    const match = isCalObject
      ? line.match(/OBJECT\s+(\w+)\s+(\d+)\s+(.*)/i)
      : line.match(/(\w+extension)\s+(\d+)\s+["']([^"']+)["']/i);

    if (match) {
      this.currentObject.type = match[1];
      this.currentObject.id = match[2];
      this.currentObject.name = match[3];
    }

    this.objectCount++;
  }

  _finalizeCurrentObject() {
    const result = { ...this.currentObject };
    this.resetCurrentObject();
    return result;
  }

  resetCurrentObject() {
    this.currentObject = {
      content: [],
      type: "",
      id: "",
      name: "",
    };
  }
}

/**
 * Writable stream that handles saving objects to files
 */
class ObjectWriterStream extends Writable {
  constructor(outputPath, organizeByType, options = {}) {
    super({
      ...options,
      objectMode: true,
      highWaterMark: 32,
    });
    this.outputPath = outputPath;
    this.organizeByType = organizeByType;
    this.objectCountsByType = new Map();
    this.extractedFiles = new Set();
    this.writeQueue = [];
    this.dirCache = new Set();
    this.queueDrain = Promise.resolve();
  }

  _write(object, encoding, callback) {
    try {
      const targetFolder = this._getTargetFolder(object.type);
      const fileName = this._getFileName(object);
      const filePath = path.join(targetFolder, fileName);
      const content = object.content.join("\n") + "\n";

      this.writeQueue.push({ filePath, content, type: object.type });

      // Process queue when it reaches threshold
      if (this.writeQueue.length >= 100) {
        this.queueDrain = this._processQueue();
      }

      callback();
    } catch (error) {
      callback(error);
    }
  }

  async _processQueue() {
    if (this.writeQueue.length === 0) return;

    const batch = this.writeQueue;
    this.writeQueue = [];

    // Group by directory for efficient mkdir
    const dirGroups = new Map();
    for (const item of batch) {
      const dir = path.dirname(item.filePath);
      if (!dirGroups.has(dir)) {
        dirGroups.set(dir, []);
      }
      dirGroups.get(dir).push(item);
    }

    // Process each directory group
    for (const [dir, items] of dirGroups) {
      await this._ensureDirectoryExists(dir);

      // Write files in parallel
      await Promise.all(
        items.map(async (item) => {
          await fs.promises.writeFile(item.filePath, item.content);
          this.extractedFiles.add(item.filePath);
          this.objectCountsByType.set(
            item.type,
            (this.objectCountsByType.get(item.type) || 0) + 1
          );
        })
      );
    }
  }

  _final(callback) {
    this.queueDrain
      .then(() => this._processQueue())
      .then(() => callback())
      .catch(callback);
  }

  async finalize() {
    await new Promise((resolve, reject) => {
      this._final((error) => (error ? reject(error) : resolve()));
    });

    const summaryFilePath = path.join(
      this.outputPath,
      "_extraction_summary.txt"
    );
    const summaryContent = this._generateSummary();
    await fs.promises.writeFile(summaryFilePath, summaryContent);

    return {
      files: Array.from(this.extractedFiles),
      summaryFile: summaryFilePath,
      success: true,
    };
  }

  _getTargetFolder(objectType) {
    if (this.organizeByType && objectType) {
      return path.join(this.outputPath, objectType + "s");
    }
    return this.outputPath;
  }

  _getFileName(object) {
    if (!object.type || !object.id || !object.name) {
      return `Unknown_Object_${Date.now()}.txt`;
    }
    const cleanName = object.name
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .trim();
    return `${object.type}${object.id}_${cleanName}.txt`;
  }

  async _ensureDirectoryExists(dirPath) {
    if (this.dirCache.has(dirPath)) return;

    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      this.dirCache.add(dirPath);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      this.dirCache.add(dirPath);
    }
  }

  _generateSummary() {
    const totalObjects = Array.from(this.objectCountsByType.values()).reduce(
      (sum, count) => sum + count,
      0
    );

    let content = `Extraction Summary\n`;
    content += `----------------\n`;
    content += `Extraction date: ${new Date().toLocaleString()}\n\n`;
    content += `Total objects extracted: ${totalObjects}\n\n`;
    content += `Base extraction path: ${this.outputPath}\n\n`;
    content += `Objects by type:\n`;

    for (const [type, count] of this.objectCountsByType) {
      content += `- ${type}s: ${count}\n`;
    }

    return content;
  }
}

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

    await fs.promises.mkdir(outputFolderPath, { recursive: true });

    const splitter = new ObjectSplitterTransform();
    const writer = new ObjectWriterStream(outputFolderPath, organizeByType);

    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(sourceFilePath, {
        encoding: "utf8",
        highWaterMark: 256 * 1024, // 256KB chunks
      });

      readStream
        .pipe(splitter)
        .pipe(writer)
        .on("finish", resolve)
        .on("error", reject);

      readStream.on("error", reject);
    });

    return await writer.finalize();
  } catch (error) {
    console.error("Error extracting objects:", error);
    throw error;
  }
}

module.exports = {
  extractObjects,
};
