import diagramToolPrompt from "@/ai/prompts/tools/diagram-tool.prompt.md";
import mermaidToolPrompt from "@/ai/prompts/tools/mermaid-tool.prompt.md";
import jsxGraphToolPrompt from "@/ai/prompts/tools/jsxgraph-tool.prompt.md";

export function getEnabledToolCallingPrompts() {
  return [diagramToolPrompt, mermaidToolPrompt, jsxGraphToolPrompt];
}
