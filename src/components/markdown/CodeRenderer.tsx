import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockItem,
  CodeBlockContent,
  BundledLanguage,
} from "../ui/shadcn-io/code-block";

export type CodeRendererProps = {
  language: string;
  content: string;
};

export default function CodeRenderer({ language, content }: CodeRendererProps) {
  return (
    <CodeBlock
      data={[
        {
          language: language,
          filename: "",
          code: content,
        },
      ]}
      defaultValue={language}
    >
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem key={item.language} value={item.language}>
            <CodeBlockContent language={item.language as BundledLanguage}>
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  );
}
