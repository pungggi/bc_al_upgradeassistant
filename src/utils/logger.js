const vscode = require("vscode");
const { EXTENSION_ID } = require("../constants");

// Log level constants
const LOG_LEVELS = {
  VERBOSE: "verbose",
  NORMAL: "normal",
  MINIMAL: "minimal",
};

// Default to normal if not specified
let currentLogLevel = LOG_LEVELS.NORMAL;

/**
 * Custom logger that respects the configured log level
 */
const logger = {
  /**
   * Log verbose-level messages (only shown when log level is VERBOSE)
   */
  verbose: function (...args) {
    if (currentLogLevel === LOG_LEVELS.VERBOSE) {
      console.log(...args);
    }
  },
  
  /**
   * Log info-level messages (shown when log level is VERBOSE or NORMAL)
   */
  info: function (...args) {
    if (
      currentLogLevel === LOG_LEVELS.VERBOSE ||
      currentLogLevel === LOG_LEVELS.NORMAL
    ) {
      console.log(...args);
    }
  },
  
  /**
   * Log warning messages (always shown)
   */
  warn: function (...args) {
    console.warn(...args);
  },
  
  /**
   * Log error messages (always shown)
   */
  error: function (...args) {
    console.error(...args);
  },
  
  /**
   * Set the current log level
   * @param {string} level - One of the LOG_LEVELS values
   */
  setLogLevel: function (level) {
    if (Object.values(LOG_LEVELS).includes(level)) {
      currentLogLevel = level;
      this.info(`Log level set to: ${currentLogLevel}`);
    } else {
      this.warn(`Invalid log level: ${level}`);
    }
  },
  
  /**
   * Get the current log level
   * @returns {string} Current log level
   */
  getLogLevel: function () {
    return currentLogLevel;
  },
  
  /**
   * Initialize the logger with the configured log level from settings
   */
  initialize: function () {
    try {
      const config = vscode.workspace.getConfiguration(EXTENSION_ID);
      const configuredLogLevel = config.get("logLevel", "normal");
      this.setLogLevel(configuredLogLevel);
    } catch (error) {
      console.error("Error initializing logger:", error);
      // Fall back to default log level
      currentLogLevel = LOG_LEVELS.NORMAL;
    }
  }
};

// Export the logger and constants
module.exports = {
  logger,
  LOG_LEVELS
};
