const vscode = require("vscode");

/**
 * Track registered commands to prevent duplicates
 * @type {Set<string>}
 */
const registeredCommands = new Set();

/**
 * Register a command if it hasn't been registered already
 * @param {vscode.ExtensionContext} context - Extension context
 * @param {string} commandId - Command identifier
 * @param {Function} handler - Command handler function
 */
function registerCommandOnce(context, commandId, handler) {
  if (registeredCommands.has(commandId)) {
    console.log(`Command ${commandId} already registered, skipping`);
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(commandId, handler)
  );

  registeredCommands.add(commandId);
}

module.exports = {
  registerCommandOnce,
};
