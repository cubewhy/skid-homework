import { lexer, type Token } from "marked";
import type { ExplanationStep, ProblemSolution } from "@/store/problems-store";

// SECTION: Type Definitions

export interface SolveResponse {
  problems: ProblemSolution[];
}

export interface ImproveResponse {
  improved_answer: string;
  improved_explanation: string;
  improved_steps: ExplanationStep[];
}

// SECTION: Core Logic (Using 'marked' AST/Lexer)

/**
 * Helper class to parse markdown structures using AST tokens instead of Regex.
 */
class MarkdownSectionParser {
  private tokens: Token[];

  constructor(markdown: string) {
    // 1. Clean up fence wrappers if present
    const cleanMarkdown = this.trimMarkdownFence(markdown);
    // 2. Tokenize the markdown string
    this.tokens = lexer(cleanMarkdown);
  }

  /**
   * Remove ```text ... ``` wrappers
   */
  private trimMarkdownFence(content: string): string {
    const regex = /^```(?:\w+\s*)?\n?([\s\S]*)\n?```$/;
    const match = content.trim().match(regex);
    return match ? match[1].trim() : content.trim();
  }

  /**
   * Extracts content grouped by H3 headers (### KEY).
   * Example: ### PROBLEM_TEXT -> content
   */
  public getSectionsByH3(): Record<string, string> {
    const sections: Record<string, string> = {};
    let currentKey: string | null = null;

    for (const token of this.tokens) {
      if (token.type === "heading" && token.depth === 3) {
        // Found a Header (e.g., "### ANSWER")
        // Normalize key: remove formatting, trim
        currentKey = token.text.trim();
        if (!currentKey) continue;
        sections[currentKey] = "";
      } else if (currentKey) {
        // Append raw content to the current section
        // token.raw preserves original formatting (newlines, lists, etc.)
        sections[currentKey] += token.raw;
      }
    }

    // Trim whitespace from all extracted values
    for (const key in sections) {
      sections[key] = sections[key].trim();
    }

    return sections;
  }

  /**
   * Static helper to parse steps from a specific explanation string.
   * Looks for H4 headers (#### Step X) to split content.
   */
  public static parseSteps(explanationText: string): ExplanationStep[] {
    if (!explanationText) return [];

    const tokens = lexer(explanationText);
    const steps: ExplanationStep[] = [];
    let currentStep: ExplanationStep | null = null;

    for (const token of tokens) {
      // Check for H4 Header (#### Step ...)
      if (token.type === "heading" && token.depth === 4) {
        // Save previous step if exists
        if (currentStep) {
          steps.push(currentStep);
        }

        // Start new step
        currentStep = {
          title: token.text.trim(), // e.g., "Step 1: Analysis"
          content: "",
        };
      } else if (currentStep) {
        // Append to current step
        currentStep.content += token.raw;
      }
    }

    // Push the last step
    if (currentStep) {
      steps.push(currentStep);
    }

    // Clean up contents
    steps.forEach((s) => (s.content = s.content.trim()));

    // Fallback: If no H4 steps were found, treat whole text as one step
    if (steps.length === 0 && explanationText.trim()) {
      return [
        {
          title: "Detailed Explanation",
          content: explanationText.trim(),
        },
      ];
    }

    return steps;
  }
}

// SECTION: Solve Response Parsing

export function parseSolveResponse(response: string): SolveResponse {
  // 1. The input might contain multiple problems separated by a distinct string.
  // Regex is still fine for this high-level split as it's a specific delimiter,
  // or simple string split.
  const rawChunks = response.split("---PROBLEM_SEPARATOR---");
  const problems: ProblemSolution[] = [];

  for (const chunk of rawChunks) {
    if (!chunk.trim()) continue;

    // Use Marked to parse this chunk
    const parser = new MarkdownSectionParser(chunk);
    const sections = parser.getSectionsByH3();

    // Map known keys to our interface
    // Note: Keys match the token.text (e.g., "PROBLEM_TEXT")
    const problemText = sections["PROBLEM_TEXT"] || "";
    const explanation = sections["EXPLANATION"] || "";
    const answer = sections["ANSWER"] || "";
    const hasOnlineSearch = Object.prototype.hasOwnProperty.call(
      sections,
      "ONLINE_SEARCH",
    );
    const onlineSearch = hasOnlineSearch ? sections["ONLINE_SEARCH"] : undefined;

    if (problemText || explanation || answer || onlineSearch) {
      problems.push({
        problem: problemText || (onlineSearch ? "Online Search Results" : ""),
        explanation:
          explanation || (onlineSearch ? "See search results below." : ""),
        answer: answer || "",
        // Parse steps specifically from the explanation text
        steps: MarkdownSectionParser.parseSteps(explanation),
        onlineSearch,
      });
    } else if (chunk.trim()) {
      // Fallback: If the chunk has content but no headers (and no online search section found via headers)
      // We treat the whole chunk as the explanation.
      problems.push({
        problem: "Parsed Content",
        explanation: chunk.trim(),
        answer: "",
        steps: MarkdownSectionParser.parseSteps(chunk.trim()),
        onlineSearch: undefined,
      });
    }
  }

  // Fallback for completely failed parsing
  if (problems.length === 0 && response.trim()) {
    return {
      problems: [
        {
          problem: "Error parsing problem text",
          answer: "",
          explanation: response,
          steps: [{ title: "Error", content: response }],
          onlineSearch: undefined,
        },
      ],
    };
  }

  return { problems };
}

// SECTION: Improve Response Parsing

export function parseImproveResponse(response: string): ImproveResponse | null {
  const parser = new MarkdownSectionParser(response);
  const sections = parser.getSectionsByH3();

  const improvedExplanation = sections["IMPROVED_EXPLANATION"];
  const improvedAnswer = sections["IMPROVED_ANSWER"];

  if (!improvedExplanation && !improvedAnswer) {
    console.error("Failed to parse Improve Response keys.");
    return null;
  }

  return {
    improved_answer: improvedAnswer || "",
    improved_explanation: improvedExplanation || "",
    improved_steps: MarkdownSectionParser.parseSteps(improvedExplanation || ""),
  };
}
