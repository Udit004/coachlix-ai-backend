// src/ai/graph/fitness/index.js

import { StateGraph, END, START } from "@langchain/langgraph";
import { GraphState } from "./state.js";
import {
  intentNode,
  greetingNode,
  directGeneralNode,
  buildSimplePromptNode,
  retrieveContextNode,
  goalNode,
  buildPromptNode,
  llmNode,
  toolsNode,
  inputGuardrailNode,
} from "./nodes/index.js";
import { routeAfterClassify, shouldContinueToTools } from "./edges.js";
import { QueryType } from "../../reasoning/intentRouter.js";

export function buildFitnessGraph() {
  const workflow = new StateGraph(GraphState)
    .addNode("inputGuardrail", inputGuardrailNode)
    .addNode("classify", intentNode)
    .addNode("greeting", greetingNode)
    .addNode("directGeneral", directGeneralNode)
    .addNode("buildSimplePrompt", buildSimplePromptNode)
    .addNode("retrieveContext", retrieveContextNode)
    .addNode("goal", goalNode)
    .addNode("buildPrompt", buildPromptNode)
    .addNode("llm", llmNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "inputGuardrail")
    .addConditionalEdges("inputGuardrail", (state) => {
      if (state.queryType === QueryType.OFF_TOPIC) {
        console.log("[Graph:route] inputGuardrail -> greeting (blocked)");
        return "greeting";
      }
      return "classify";
    })
    .addConditionalEdges("classify", routeAfterClassify, {
      greeting: "greeting",
      directGeneral: "directGeneral",
      general: "buildSimplePrompt",
      personalized: "retrieveContext",
    })
    .addEdge("greeting", END)
    .addEdge("directGeneral", END)
    .addEdge("buildSimplePrompt", "llm")
    .addEdge("retrieveContext", "goal")
    .addEdge("goal", "buildPrompt")
    .addEdge("buildPrompt", "llm")
    .addConditionalEdges("llm", shouldContinueToTools)
    .addEdge("tools", "llm");

  return workflow.compile();
}

let compiledGraph = null;

export function getCompiledGraph() {
  if (!compiledGraph) {
    console.log("[Graph] Compiling StateGraph for the first time...");
    compiledGraph = buildFitnessGraph();
    console.log("[Graph] StateGraph compiled and cached");
  }
  return compiledGraph;
}
