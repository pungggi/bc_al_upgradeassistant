# BC/AL Upgrade Assistant

A Visual Studio Code extension to assist in upgrading from older NAV or BC Versions, organize your Upgrade Tasks and provide AI-powered assistance if needed.

## Features

- Documentation Reference Management. Keep track of your progress and notes.
- Navigate to and from Referenced Migration files (.txt)
- Suggests available events to subscribe to
- Migrate obsolete code. (like NoSeriesManagement, Codeunit 1 and more)
- AI-powered custom prompts. Create .al Files directly from the response.

A tutorial of how to use those features will be released.

Any [feedback](https://ngsoftware.canny.io/requests) is welcome.

## Requirements

- Visual Studio Code 1.99.2 or higher
- Claude API key or a Github Copilot Subscription for AI-powered features

### Documentation Reference Management

The extension helps track and manage documentation references like Project and Task Id's in your code:

- Track documentation references with status (Done/Not Done/Not Implemented)
- Add notes to documentation references
- Generate summary reports of all documentation references with statistics

The extension supports a collection of documentation references through the `bc-al-upgradeassistant.documentationIds` setting. This allows you to maintain a curated list of documentation references like tasks or projects.

> After modifying settings, you'll need to reload the window for changes to take effect.

### Customizing Documentation IDs

You can modify these defaults or add your own documentation references in your settings.

Example custom configuration:

```json
"bc-al-upgradeassistant.documentationIds": [
  {
    "id": "VAT001",
    "description": "Project Task for implementing the new VAT Logic",
    "url": "https://dev.azure.com/contoso/_userstory/vat"
  }
]
```

Each documentation ID requires:

- `id`: A unique identifier
- `description`: A brief description of the documentation
- `url`: (Optional) Link to the documentation resource

### Default Assignee

- `bc-al-upgradeassistant.userId`: User identifier used to attach to documentation references when toggling their status.

#### Summary Report

The documentation reference summary report shows some Status indicators:

- ✅ Done
- ⏳ Pending
- ❌ Not Implemented
- Statistical overview with completion percentages
- References grouped by file and by documentation ID

The summary is generated when running the command `BC/AL Upgrade Assistant: Generate Documentation References Summary`.

### Object Folders Settings

- `bc-al-upgradeassistant.upgradedObjectFolders`: Locations where to save upgraded AL objects by type
  - Includes a `basePath` property which specifies the base folder for all object types
- `bc-al-upgradeassistant.workingObjectFolders`: Locations where working AL objects are located

## AI Model Backend Selection

The extension supports two AI model backends:

- **Claude API**: External API connection to Anthropic's Claude models (requires API key)
- **VS Code Language Model API**: Built-in VS Code language models (requires Github Copilot Subscription)

You can select your preferred backend through the `bc-al-upgradeassistant.languageModelBackend` setting:

```json
"bc-al-upgradeassistant.languageModelBackend": "VS Code Language Model API"
```

### VS Code Language Model API Settings

When using the VS Code Language Model API backend:

- `bc-al-upgradeassistant.vscodeLanguageModelId`: Select the VS Code language model to use (e.g., "claude-3.5-sonnet", "gpt-4o-mini")

### AI Model Settings

The following settings apply to both Claude API and VS Code Language Model API backends:

- `bc-al-upgradeassistant.defaultSystemPrompt`: Default system prompt to use with AI models
- `bc-al-upgradeassistant.defaultLanguage`: Default language code (e.g., "de-DE") to use in prompts as the translation language
- `bc-al-upgradeassistant.prompts`: Collection of prompts for AI models
- `bc-al-upgradeassistant.autoSaveAlCode`: When enabled, automatically saves AL code blocks from AI responses
- `bc-al-upgradeassistant.codeSaveMode`: How to handle multiple AL code blocks ("ask" or "saveAll")
- `bc-al-upgradeassistant.debugMode`: When enabled, shows the prompt being sent to the AI model in a document for review before sending

### Claude API Specific Settings

The following settings only apply when using the Claude API backend:

- `bc-al-upgradeassistant.claude.apiKey`: API Key for accessing Claude API
- `bc-al-upgradeassistant.claude.model`: Claude model to use for API requests
- `bc-al-upgradeassistant.claude.maxTokens`: Maximum number of tokens Claude can generate (default: 4096)
- `bc-al-upgradeassistant.claude.temperature`: Creativity control (0-1), lower values produce more deterministic outputs (default: 0.5)

### Configuring Custom Prompts

You can customize the AI prompts through the settings, for example:

```json
"bc-al-upgradeassistant.prompts": [
  {
    "commandName": "convertCALToAL",
    "commandDescription": "Convert C/AL code to modern AL syntax",
    "userPrompt": "Please convert the following C/AL code to AL:\n\n{{code}}",
    "systemPrompt": "You are an expert AL and C/AL programming assistant. You help developers convert legacy C/AL code to modern AL code for Business Central.",
  },
  {
    "commandName": "reviewALCode",
    "commandDescription": "Review AL code for best practices",
    "disabled": true,
    "systemPrompt": "You are an AL code reviewer specializing in Business Central best practices.",
    "userPrompt": "Review the following AL code and suggest improvements for performance and readability:\n\n{{code}}",
  },
  {
    "commandName": "explainComplexLogic",
    "commandDescription": "Explain complex logic using Opus model",
    "userPrompt": "Explain in detail how the following complex algorithm works:\n\n{{code}}",
    "systemPrompt": "You are an expert AL code explainer for Microsoft Dynamics 365 Business Central.",
    "model": "claude-3-opus-20240229",
  }
]
```

Each prompt has the following properties:

- `commandName`: A unique identifier for the prompt (no spaces)
- `commandDescription`: A brief description of what the command does (shown in the selection dialog)
- `userPrompt`: The actual prompt template. Use `{{code}}` where you want the selected code to be inserted
- `systemPrompt`: (Optional) Instructions for the AI about its role
- `model`: (Optional) Specific Claude model to use for this prompt
- `disabled`: (Optional) A boolean to disable the prompt without removing it from the settings

> The extension will fall back to your default model from `bc-al-upgradeassistant.claude.model` if no valid model is specified.

### Debugging AI Prompts

When working with complex prompts, you can enable the debug mode to review exactly what is being sent to the Claude API:

1. Set `bc-al-upgradeassistant.debugMode` to `true` in your VS Code settings
2. Run any AI prompt
3. A new document will open showing the system prompt, user prompt with your code inserted, and configuration details

## Upgrade specific analysis and code suggestions

The extension supports extracting source files from compiled Business Central app (.app) files for upgrade specific analysis and code suggestions:
To use this feature enable source extraction in settings:

- **Enable Source Extraction**: Turn on/off the source extraction capability through `bc-al-upgradeassistant.enableSrcExtraction` setting

## Field Name Suggestion

When an unknown or misspelled field is used, the extension will show quick fix suggestions. Similar field names are detected using string similarity, allowing you to easily replace the invalid field with a valid one.

## Commands

### General

- `BC/AL Upgrade Assistant: Split C/AL Objects (Select File)`: Splits C/AL objects from a text file into individual files.
- `BC/AL Upgrade Assistant: Refresh Symbol Cache`: Refreshes the symbol cache to update object metadata and source if available.

### Documentation

- `BC/AL Upgrade Assistant: Toggle Documentation Reference as Done/Not Done`: Toggles the completion status of a documentation reference and silently adds the configured UserId if set.
- `BC/AL Upgrade Assistant: Toggle Not Implemented`: Toggles the 'Not Implemented' status of a documentation reference.
- `BC/AL Upgrade Assistant: Add/Edit Note`: Adds or edits a note for a documentation reference.
- `BC/AL Upgrade Assistant: Generate Documentation References Summary`: Generates a summary report of all documentation references.

### Navigation

- `BC/AL Upgrade Assistant: Open Documentation URL`: Opens the URL associated with a documentation reference.
- `BC/AL Upgrade Assistant: Open Documentation Reference Location`: Opens the location of the documentation reference.

- `BC/AL Upgrade Assistant: Open Referenced Object`: Opens the AL object referenced under the cursor.
- `BC/AL Upgrade Assistant: Open Migration File`: Opens the related migration file, if available.

- `BC/AL Upgrade Assistant: Refresh BC/AL References`: Refreshes the references view.

### AI Prompting

- `BC/AL Upgrade Assistant: Run Configured AI Prompt`: Runs a selected AI prompt on the current code.
- `BC/AL Upgrade Assistant: Set Default Claude Model`: Sets the default Claude model to be used for AI prompts.
