# Claude API Integration

This document explains how the BC/AL Upgrade Assistant integrates with Claude, an AI assistant by Anthropic.

## API Implementation

The extension uses Anthropic's Messages API to communicate with Claude. The implementation:

1. Retrieves the API key from VS Code settings
2. Constructs a request with system and user prompts
3. Sends the request to the Claude API
4. Processes and formats the response

## API Requirements

- **Claude API Key**: Required to authenticate with Anthropic's API
- **System Prompt**: Instructions for Claude about its role and context
- **User Prompt**: The actual query containing the code to be processed

## Available Models

The extension supports the following Claude models:

- **Claude 3.7 Sonnet**: Most intelligent model, best for complex reasoning tasks
- **Claude 3.5 Sonnet**: Good balance between performance and cost
- **Claude 3.5 Haiku** (default): Fast and efficient for daily coding tasks
- **Claude 3 Opus**: Most capable original model, highest cost
- **Claude 3 Haiku**: Original Haiku model, fast but less capable

You can set the default model in Settings > Extensions > BC/AL Upgrade Assistant > Claude Model.

### Per-Prompt Model Selection

Each prompt can also specify its own model, which will override the default:

```json
{
  "commandName": "explainComplexLogic",
  "commandDescription": "Explain complex logic using Opus model",
  "model": "claude-3-opus-20240229",
  "systemPrompt": "You are an expert AL code explainer...",
  "userPrompt": "Explain in detail how the following complex algorithm works:\n\n{{code}}"
}
```

This allows you to use the more capable Opus model for complex tasks while using the faster and more cost-effective models for simpler tasks.

## Response Processing

The extension processes Claude's response, which can contain multiple content blocks, and formats it as markdown in a new document.

## Error Handling

The extension handles various error scenarios:

- Missing or invalid API key
- Rate limiting (429 errors)
- Server errors (500 errors)
- Other API error responses

## Technical Details

### API Endpoint

```
https://api.anthropic.com/v1/messages
```

### Request Format

```json
{
  "model": "claude-3-5-haiku-20241022",
  "max_tokens": 4000,
  "messages": [
    {
      "role": "user",
      "content": "User prompt with code"
    }
  ],
  "system": "System instructions for Claude"
}
```

### Headers

```
Content-Type: application/json
x-api-key: [Your API Key]
anthropic-version: 2023-06-01
```

## Troubleshooting

If you encounter issues with the Claude integration:

1. Verify your API key is correctly set in settings
2. Check the VS Code Developer Tools console for detailed error messages
3. Ensure your prompt is not too long (Claude has input limitations)
4. If you receive rate limit errors, wait a few minutes before trying again
