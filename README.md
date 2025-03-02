# AL Extension Info

This extension provides hover information about extended objects in AL code and tools to assist with AL upgrades.

## Features

- Hover over `extends` object to see details about the base object
- Supports symbols from `.alpackages` folder for complete reference information
- Split CAL objects from older Business Central versions
- AI-powered code assistance with Claude API integration

## Usage

### Extension Info Hover

1. Open an AL file containing extension objects
2. Hover over the `extends` object to see information about the extended object

### Split CAL Objects

1. Open the command palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run the command "AL: Split CAL Objects"
3. Follow the prompts to select source files and splitting options

## Commands

- **AL: Refresh Extension Info Cache** - Manually refresh the extension info cache
- **AL: Split CAL Objects** (`bc-al-upgradeassistant.splitCalObjects`) - Split CAL objects from older BC versions for reference or migration
- **Run Claude AI Prompt** (`bc-al-upgradeassistant.selectClaudePrompt`) - Execute AI prompts on selected code

## Claude AI Integration

The BC/AL Upgrade Assistant includes AI-powered assistance via Claude API. To use this feature:

### Setup

1. Obtain a Claude API key from [Anthropic](https://console.anthropic.com/)
2. Add your API key in VS Code settings:
   - Go to Settings > Extensions > BC/AL Upgrade Assistant
   - Enter your API key in the "Claude API Key" field
   - Optionally, select your preferred Claude model (default is Claude 3.5 Sonnet)

### Using the Prompt Selection Dialog

1. Select some code in your editor (or the current file will be used if no selection)
2. Open the command palette (Ctrl+Shift+P / Cmd+Shift+P)
3. Run the command "BC AL Upgrade Assistant: Run Claude AI Prompt"
4. A dialog will appear showing available AI prompts with their descriptions:

   ![Prompt Selection Dialog](media/prompt-dialog.png)

5. Select the prompt you want to execute
6. The extension will process your code with Claude API and display the results in a new editor tab

### Model Selection

The extension supports multiple Claude models:

- **Claude 3.7 Sonnet**: Most intelligent model, best for complex reasoning
- **Claude 3.5 Sonnet**: Good balance between performance and cost
- **Claude 3.5 Haiku** (default): Fast and efficient for daily tasks
- **Claude 3 Opus**: Most capable original model, but higher cost
- **Claude 3 Haiku**: Original Haiku model

You can change the default model in three ways:

1. Through Settings > Extensions > BC/AL Upgrade Assistant > Claude Model
2. Using the quick commands:
   - `BC AL Upgrade Assistant: Set Default Model to Claude 3.7 Sonnet`
   - `BC AL Upgrade Assistant: Set Default Model to Claude 3.5 Sonnet`
   - `BC AL Upgrade Assistant: Set Default Model to Claude 3.5 Haiku`
   - `BC AL Upgrade Assistant: Set Default Model to Claude 3 Opus`
   - `BC AL Upgrade Assistant: Set Default Model to Claude 3 Haiku`
3. Specifying a model for individual prompts in your settings (see examples below)

### Available Commands

The extension comes with pre-configured prompts:

- **convertCALToAL** - Converts C/AL code to modern AL syntax
- **reviewALCode** - Provides code review and suggestions for AL code

### Configuring Custom Prompts

You can customize the AI prompts through the settings:

```json
"bc-al-upgradeassistant.claude.prompts": [
  {
    "commandName": "convertCALToAL",
    "commandDescription": "Convert C/AL code to modern AL syntax",
    "systemPrompt": "You are an expert AL and C/AL programming assistant. You help developers convert legacy C/AL code to modern AL code for Business Central.",
    "userPrompt": "Please convert the following C/AL code to AL:\n\n{{code}}",
    "example": "OnOpenPage()\nBEGIN\n  CurrForm.UPDATE;\nEND;"
  },
  {
    "commandName": "reviewALCode",
    "commandDescription": "Review AL code for best practices",
    "systemPrompt": "You are an AL code reviewer specializing in Business Central best practices.",
    "userPrompt": "Review the following AL code and suggest improvements for performance and readability:\n\n{{code}}",
    "example": ""
  },
  {
    "commandName": "explainComplexLogic",
    "commandDescription": "Explain complex logic using Opus model",
    "model": "claude-3-opus-20240229",
    "systemPrompt": "You are an expert AL code explainer for Microsoft Dynamics 365 Business Central.",
    "userPrompt": "Explain in detail how the following complex algorithm works:\n\n{{code}}",
    "example": ""
  },
  {
    "commandName": "quickFormat",
    "commandDescription": "Quick code formatting using Haiku model",
    "model": "claude-3-haiku-20240307",
    "systemPrompt": "You are a code formatter that improves readability without changing functionality.",
    "userPrompt": "Format and improve the indentation of this code without changing its functionality:\n\n{{code}}",
    "example": ""
  },
  {
    "commandName": "explainComplexAI",
    "commandDescription": "Use Claude 3.7 to explain complex AI concepts",
    "model": "claude-3-7-sonnet-20250219",
    "systemPrompt": "You are an AI expert with deep understanding of complex algorithms. Explain concepts clearly.",
    "userPrompt": "Explain the following algorithm as if explaining to another developer:\n\n{{code}}"
  },
  {
    "commandName": "quickReview",
    "commandDescription": "Quick code review using Claude 3.5 Haiku",
    "model": "claude-3-5-haiku-20241022",
    "systemPrompt": "You are a quick code reviewer. Focus only on major issues.",
    "userPrompt": "Do a quick review of this code, focusing only on major issues:\n\n{{code}}"
  }
]
```

Each prompt has the following properties:

- `commandName`: A unique identifier for the prompt (no spaces)
- `commandDescription`: A brief description of what the command does (shown in the selection dialog)
- `model`: (Optional) Specific Claude model to use for this prompt (dropdown selection in settings UI)
- `systemPrompt`: Instructions for the AI about its role (optional, falls back to default)
- `userPrompt`: The actual prompt template. Use `{{code}}` where you want the selected code to be inserted
- `example`: An optional example (not shown in the dialog but helps users understand the prompt)

**Note:** The extension will validate model names and fall back to your default model if an invalid model is specified.

**Note:** After modifying prompts in settings, you'll need to reload the window for changes to take effect.
