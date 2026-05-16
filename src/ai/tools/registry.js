/**
 * Tool Registry & Management System
 * Centralizes tool registration, discovery, and validation
 */

import { TOOL_CATEGORIES } from '../config/constants.js';

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.categories = new Map();
  }

  /**
   * Register a tool
   * @param {string} toolName - Unique tool identifier
   * @param {Object} toolConfig - Tool configuration
   * @param {string} toolConfig.category - Tool category
   * @param {string} toolConfig.description - Tool description
   * @param {Function} toolConfig.execute - Tool execution function
   * @param {Object} toolConfig.schema - Input validation schema
   * @param {Array} toolConfig.tags - Tool tags for discovery
   */
  register(toolName, toolConfig) {
    if (!toolName || !toolConfig.execute) {
      throw new Error('Tool must have a name and execute function');
    }

    // Validate required fields
    const required = ['category', 'description', 'execute'];
    for (const field of required) {
      if (!toolConfig[field]) {
        throw new Error(`Tool ${toolName} missing required field: ${field}`);
      }
    }

    this.tools.set(toolName, {
      name: toolName,
      ...toolConfig,
      registered: new Date(),
    });

    // Index by category
    if (!this.categories.has(toolConfig.category)) {
      this.categories.set(toolConfig.category, []);
    }
    this.categories.get(toolConfig.category).push(toolName);

    console.log(`✓ Registered tool: ${toolName} (${toolConfig.category})`);
  }

  /**
   * Get tool by name
   * @param {string} toolName - Tool name
   * @returns {Object} Tool configuration
   */
  getTool(toolName) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in registry`);
    }
    return tool;
  }

  /**
   * Get all tools in a category
   * @param {string} category - Tool category
   * @returns {Array} Array of tool names
   */
  getCategory(category) {
    return this.categories.get(category) || [];
  }

  /**
   * Find tools by tags
   * @param {Array} tags - Tags to search for
   * @returns {Array} Matching tools
   */
  findByTags(tags) {
    const results = [];
    for (const [name, tool] of this.tools.entries()) {
      if (tool.tags && tags.some(tag => tool.tags.includes(tag))) {
        results.push(name);
      }
    }
    return results;
  }

  /**
   * Execute a tool
   * @param {string} toolName - Tool name
   * @param {Object} inputs - Tool inputs
   * @param {Object} context - Execution context
   * @returns {Promise} Tool execution result
   */
  async execute(toolName, inputs, context = {}) {
    const tool = this.getTool(toolName);

    // Validate inputs if schema exists
    if (tool.schema) {
      this.validateInputs(inputs, tool.schema);
    }

    try {
      const result = await tool.execute(inputs, context);
      return {
        success: true,
        data: result,
        tool: toolName,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        tool: toolName,
      };
    }
  }

  /**
   * Validate tool inputs against schema
   * @param {Object} inputs - Inputs to validate
   * @param {Object} schema - Validation schema
   */
  validateInputs(inputs, schema) {
    // Simple validation - can be extended with JSON Schema or Zod
    for (const [key, rules] of Object.entries(schema)) {
      if (rules.required && !inputs[key]) {
        throw new Error(`Required input missing: ${key}`);
      }

      if (rules.type && inputs[key] && typeof inputs[key] !== rules.type) {
        throw new Error(`Invalid input type for ${key}: expected ${rules.type}`);
      }
    }
  }

  /**
   * Get all registered tools (metadata only)
   * @returns {Array} All tools with metadata
   */
  getAll() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      category: tool.category,
      description: tool.description,
      tags: tool.tags || [],
    }));
  }

  /**
   * List all categories
   * @returns {Array} Available categories
   */
  getCategories() {
    return Array.from(this.categories.keys());
  }

  /**
   * Get tool count
   * @returns {number} Total registered tools
   */
  count() {
    return this.tools.size;
  }

  /**
   * Check if tool exists
   * @param {string} toolName - Tool name
   * @returns {boolean} Tool exists
   */
  exists(toolName) {
    return this.tools.has(toolName);
  }
}

export const toolRegistry = new ToolRegistry();

export default toolRegistry;
