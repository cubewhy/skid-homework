"use client";
import React, {
  ComponentPropsWithoutRef,
  createContext,
  ReactNode,
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
import { useTranslation } from "react-i18next";
import MermaidDiagram from "./diagram/MermaidDiagram";
import DiagramRenderer from "./diagram/DiagramRenderer";
import CodeRenderer from "./CodeRenderer";
import { cn } from "@/lib/utils";

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
  const { t } = useTranslation("commons", { keyPrefix: "md" });
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
          {t("generating-diagram")}
        </TextShimmer>
      );
    }

    let component: ReactNode;
    let realLanguage = "json";

    if (lang === "plot-function") {
      component = (
        <div className="h-100 w-100">
          <MathGraph code={content} />
        </div>
      );
    }

    if (lang === "plot-force") {
      component = <ForceDiagram code={content} />;
    }

    if (lang === "plot-mermaid") {
      component = <MermaidDiagram code={content} />;
      realLanguage = "mermaid";
    }

    return (
      <DiagramRenderer language={realLanguage} content={content}>
        {component}
      </DiagramRenderer>
    );
  }

  if (match) {
    return <CodeRenderer language={lang} content={content} />;
  } else {
    return (
      <code className={cn(className, "bg-accent p-0.5 rounded")} {...props}>
        {children}
      </code>
    );
  }
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
