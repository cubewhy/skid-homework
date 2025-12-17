"use client";
import React, {
  ComponentPropsWithoutRef,
  createContext,
  useContext,
} from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import ForceDiagram from "./diagram/ForceDiagram";
import MathGraph from "./diagram/MathGraph";
import { TextShimmer } from "../ui/text-shimmer";

type UnistPoint = {
  line: number;
  column: number;
  offset?: number;
};

type UnistPosition = {
  start: UnistPoint;
  end: UnistPoint;
};

type HastNode = {
  type: string;
  tagName?: string;
  position?: UnistPosition;
  children?: HastNode[];
  properties?: Record<string, unknown>;
};

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  node?: HastNode;
};

const SourceContext = createContext<string>("");

const CodeBlock = ({
  className,
  children,
  node,
  ...props
}: MarkdownCodeProps) => {
  const source = useContext(SourceContext);

  const match = /language-([\w-]+)/.exec(className || "");
  const lang = match ? match[1] : "";
  const content = String(children).replace(/\n$/, "");

  const isBlockComplete = (() => {
    if (!node?.position?.end) return false;

    const { end } = node.position;

    if (end.offset === undefined) return true;

    if (end.offset > source.length) return false;

    const endingFence = source.slice(end.offset - 3, end.offset);
    return endingFence === "```" || endingFence === "~~~";
  })();

  if (lang.startsWith("plot-")) {
    if (!isBlockComplete) {
      return (
        <TextShimmer className="font-mono text-sm" duration={1}>
          Generating diagram...
        </TextShimmer>
      );
    }

    if (lang === "plot-function") {
      return (
        <div className="h-100 w-100">
          <MathGraph code={content} />
        </div>
      );
    }

    if (lang === "plot-force") {
      return <ForceDiagram code={content} />;
    }
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
};

const components = {
  code: CodeBlock,
};

const MarkdownRenderer = ({ source }: { source: string }) => {
  return (
    <SourceContext.Provider value={source}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { output: "html" }]]}
        components={components}
      >
        {source}
      </Markdown>
    </SourceContext.Provider>
  );
};

export const MemoizedMarkdown = React.memo(MarkdownRenderer);
