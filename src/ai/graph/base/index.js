/**
 * Base Graph Implementation
 * Foundation for state machines and workflow graphs
 */

import { GRAPH_STATES } from '../../config/constants.js';

class BaseGraph {
  constructor(name = 'BaseGraph') {
    this.name = name;
    this.nodes = new Map();
    this.edges = new Map();
    this.currentState = GRAPH_STATES.START;
  }

  /**
   * Add node to graph
   * @param {string} nodeId - Node identifier
   * @param {Object} nodeConfig - Node configuration
   */
  addNode(nodeId, nodeConfig) {
    this.nodes.set(nodeId, {
      id: nodeId,
      ...nodeConfig,
    });
  }

  /**
   * Add edge between nodes
   * @param {string} fromNode - Source node
   * @param {string} toNode - Target node
   * @param {Object} edgeConfig - Edge configuration
   */
  addEdge(fromNode, toNode, edgeConfig = {}) {
    const edgeId = `${fromNode}->${toNode}`;
    this.edges.set(edgeId, {
      from: fromNode,
      to: toNode,
      ...edgeConfig,
    });
  }

  /**
   * Execute graph for a given state
   * @param {string} state - Current state
   * @param {Object} input - Input data
   * @returns {Promise<Object>} Execution result
   */
  async execute(state, input = {}) {
    this.currentState = state;

    const node = this.nodes.get(state);
    if (!node) {
      return {
        success: false,
        error: `Node not found: ${state}`,
      };
    }

    try {
      const result = await node.execute(input);
      return {
        success: true,
        state,
        result,
      };
    } catch (error) {
      return {
        success: false,
        state,
        error: error.message,
      };
    }
  }

  /**
   * Get next state based on conditions
   * @param {string} currentState - Current state
   * @param {Object} context - Execution context
   * @returns {string} Next state
   */
  getNextState(currentState, context = {}) {
    const edgeKeys = Array.from(this.edges.keys())
      .filter(key => key.startsWith(currentState + '->'));

    if (edgeKeys.length === 0) {
      return GRAPH_STATES.END;
    }

    // Simple routing - take first edge by default
    const edge = this.edges.get(edgeKeys[0]);
    return edge.to;
  }

  /**
   * Get all nodes
   * @returns {Array} All nodes
   */
  getNodes() {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges
   * @returns {Array} All edges
   */
  getEdges() {
    return Array.from(this.edges.values());
  }

  /**
   * Get graph structure
   * @returns {Object} Graph structure
   */
  getStructure() {
    return {
      name: this.name,
      nodes: this.getNodes().map(n => ({
        id: n.id,
        label: n.label || n.id,
      })),
      edges: this.getEdges(),
    };
  }
}

export { BaseGraph };

export default BaseGraph;
