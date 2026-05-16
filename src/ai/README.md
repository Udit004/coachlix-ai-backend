# AI Module Architecture

## Overview

The AI module is a modular, scalable architecture for handling AI chat workflows, intent classification, tool orchestration, and memory management in the backend.

## Directory Structure

```
src/ai/
├── core/                    # Foundation & configuration
│   ├── llmConfig.js         # LLM initialization and management
│   └── cache.js             # AI-specific caching
├── config/
│   └── constants.js         # Configuration and enums
├── reasoning/               # Intent and entity processing
│   ├── intentClassifier.js  # Intent classification engine
│   ├── entity/              # Entity extraction (TODO)
│   ├── intent/              # Intent utilities (TODO)
│   └── utils/               # Reasoning utilities (TODO)
├── graph/                   # Agentic workflow graphs (TODO)
│   ├── base/                # Base graph implementations
│   ├── fitness/             # Fitness domain agent
│   ├── chat/                # Chat domain agent
│   ├── nodes/               # Reusable node implementations
│   └── edges/               # Edge routing logic
├── tools/                   # Reusable action tools
│   ├── registry.js          # Tool registration & discovery
│   ├── validators.js        # Input validation (TODO)
│   └── built-in/            # Built-in tools
│       ├── createDietPlanTool.js
│       ├── updateDietPlanTool.js    (TODO)
│       └── ...
├── memory/                  # Conversation & context memory
│   ├── chatMemory.js        # Chat history management
│   └── contextMemory.js     # Context retention (TODO)
├── prompts/                 # Prompt management (TODO)
│   ├── templates/           # Prompt templates
│   └── builders/            # Dynamic prompt builders
├── search/                  # Semantic search & retrieval (TODO)
│   ├── semanticRetrieval.js
│   └── contextRetrieval.js
├── streaming/               # Real-time streaming (TODO)
│   ├── messageBuilder.js
│   └── streamProcessor.js
├── multimodal/              # Multimodal content (TODO)
│   └── contentBuilder.js
├── middleware/              # AI middleware (TODO)
│   ├── aiValidator.js
│   └── streamingMiddleware.js
├── services/                # Service layer (orchestration)
│   └── aiOrchestrator.js    # Central AI orchestrator
└── index.js                 # Main export & initialization
```

## Core Components

### 1. **LLM Configuration** (`core/llmConfig.js`)
- Initialize Google Generative AI client
- Manage model instances (Gemini Pro, Flash, etc.)
- Provide generation configs and safety settings
- System prompt management

### 2. **AI Cache** (`core/cache.js`)
- Cache intent classifications
- Cache context retrieval results
- Cache conversation memory
- Efficient key generation and invalidation

### 3. **Intent Classifier** (`reasoning/intentClassifier.js`)
- Pattern-based intent classification
- Fuzzy matching with Levenshtein distance
- Confidence scoring
- Multi-intent support

### 4. **Tool Registry** (`tools/registry.js`)
- Register tools with metadata
- Tool discovery by name, category, or tags
- Tool execution with input validation
- Central tool orchestration

### 5. **Chat Memory** (`memory/chatMemory.js`)
- Session management
- Message history tracking
- Context persistence
- Conversation formatting for LLM

### 6. **AI Orchestrator** (`services/aiOrchestrator.js`)
- Central coordination hub
- Message processing pipeline
- Intent classification → Tool selection → LLM response
- Memory management integration

## Quick Start

### 1. Initialize AI Module

```javascript
// In your app.js or server setup
import { initializeAI } from './ai/index.js';

await initializeAI({
  geminiApiKey: process.env.GEMINI_API_KEY,
});
```

### 2. Register Tools

```javascript
import { registerCustomTools, toolRegistry } from './ai/index.js';
import { createDietPlanTool } from './ai/tools/built-in/createDietPlanTool.js';

// Register built-in tools
toolRegistry.register('createDietPlan', createDietPlanTool);

// Register custom tools
registerCustomTools({
  customTool: {
    category: 'utility',
    description: 'My custom tool',
    execute: async (inputs, context) => {
      // Tool logic
      return result;
    },
  },
});
```

### 3. Create Chat Route

```javascript
import { aiOrchestrator } from './ai/index.js';

app.post('/api/chat', async (request, reply) => {
  const { userId, sessionId, message } = request.body;

  const result = await aiOrchestrator.processMessage(
    userId,
    sessionId,
    message
  );

  return reply.send(result);
});
```

## API Usage

### Process User Message

```javascript
const result = await aiOrchestrator.processMessage(
  userId,           // User ID
  sessionId,        // Conversation session ID
  userMessage,      // User message
  {
    executeTools: true  // Whether to execute selected tools
  }
);

// Result structure:
{
  success: true,
  response: "Assistant response text",
  intent: "diet_create",
  confidence: 0.95,
  tools: ["createDietPlan"],
  metadata: {
    sessionId,
    userId,
    timestamp
  }
}
```

### Intent Classification

```javascript
const classification = await intentClassifier.classify(userId, query);

// Result structure:
{
  intent: "diet_create",
  confidence: 0.95,
  topThree: [
    { intent: "diet_create", score: 0.95 },
    { intent: "diet_update", score: 0.65 },
    { intent: "nutrition_info", score: 0.45 }
  ],
  query: "Create a diet plan for me"
}
```

### Chat Memory

```javascript
// Add message
await chatMemory.addMessage(userId, sessionId, {
  role: 'user',
  content: 'Hello'
});

// Get history
const history = await chatMemory.getHistory(userId, sessionId, 10);

// Update context
await chatMemory.updateContext(userId, sessionId, {
  currentGoal: 'Weight Loss',
  currentPlan: 'planId123'
});

// Get session summary
const summary = await chatMemory.getSessionSummary(userId, sessionId);
```

### Tool Registry

```javascript
// Register tool
toolRegistry.register('myTool', {
  category: 'diet',
  description: 'My tool description',
  execute: async (inputs, context) => { /* ... */ },
  schema: { /* validation schema */ }
});

// Get tool
const tool = toolRegistry.getTool('myTool');

// Execute tool
const result = await toolRegistry.execute('myTool', inputs, context);

// Discover tools
const dietTools = toolRegistry.getCategory('diet');
const allTools = toolRegistry.getAll();
```

## Creating Custom Tools

### Tool Structure

```javascript
export const myTool = {
  // Required fields
  category: 'diet',                    // Tool category
  description: 'Tool description',     // What this tool does
  
  // Required function
  execute: async (inputs, context) => {
    // Implement tool logic
    return result;
  },

  // Optional fields
  tags: ['tag1', 'tag2'],              // Tags for discovery
  schema: {                            // Input validation
    inputName: {
      type: 'string',
      required: true,
    }
  }
};

// Register it
toolRegistry.register('myTool', myTool);
```

### Example Tool: Custom Greeting

```javascript
export const greetingTool = {
  category: 'utility',
  description: 'Generates personalized greetings',
  tags: ['greeting', 'welcome'],

  execute: async (inputs, context) => {
    const { userName } = inputs;
    return {
      message: `Hello ${userName || 'friend'}! How can I help you today?`,
    };
  },
};
```

## Configuration

See `config/constants.js` for all configuration options:

- **Models**: Available LLM models
- **Intents**: Supported intent types
- **Entities**: Entity types for NER
- **Goals**: Fitness goals
- **Cache TTL**: Cache expiration times
- **Validation**: Input constraints

## Performance Considerations

1. **Caching**: Intent classification results are cached by user + query
2. **Message Limit**: Chat history limited to last 50 messages
3. **Async Operations**: All I/O operations are asynchronous
4. **Tool Execution**: Tools execute in parallel when possible
5. **Memory Management**: Sessions can be archived and cleaned up

## Extending the Module

### Add New Intent

1. Add to `AI_CONFIG.INTENTS` in `config/constants.js`
2. Add pattern to `intentClassifier.initializePatterns()`
3. Map intent to tools in `aiOrchestrator.selectTools()`

### Add New Tool

1. Create tool file in `tools/built-in/`
2. Implement tool structure with execute function
3. Register during initialization or via `registerCustomTools()`

### Add Graph Node (Advanced)

1. Create node in `graph/nodes/`
2. Implement execute and validation methods
3. Register in graph state machine

## Testing

```javascript
// Test intent classification
const result = await intentClassifier.classify(userId, "Create a diet plan");
console.assert(result.intent === 'diet_create');

// Test tool execution
const toolResult = await toolRegistry.execute('createDietPlan', {
  userId,
  goal: 'Weight Loss',
  duration: 30
});
console.assert(toolResult.success === true);

// Test orchestration
const orchestratorResult = await aiOrchestrator.processMessage(
  userId,
  sessionId,
  "Create a diet plan"
);
console.assert(orchestratorResult.success === true);
```

## TODO / Future Enhancements

- [ ] Graph-based workflow orchestration (LangGraph)
- [ ] Entity extraction from user messages
- [ ] Advanced context retrieval with semantic search
- [ ] Streaming responses with Server-Sent Events
- [ ] Multimodal content handling (images, audio)
- [ ] LangSmith integration for debugging/monitoring
- [ ] Custom domain agents (fitness-specific graphs)
- [ ] Fine-tuned intent classification with ML models
- [ ] Conversation summarization
- [ ] Multi-turn dialogue management

## Troubleshooting

### Issue: "Model not initialized"
**Solution**: Ensure `initializeAI()` is called before using orchestrator

### Issue: "Tool not found"
**Solution**: Register tool before using it via `toolRegistry.register()`

### Issue: Memory usage growing
**Solution**: Archive or clear old sessions with `chatMemory.archiveSession()`

### Issue: Intent misclassification
**Solution**: Add more keywords to intent patterns or increase confidence threshold

## License

Part of CoachLix AI project
