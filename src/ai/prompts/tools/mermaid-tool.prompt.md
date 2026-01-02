## Mermaid Tool (`plot-mermaid`)

Mermaid is a JavaScript based diagramming and charting tool that uses Markdown-inspired text definitions and a renderer to create and modify complex diagrams. The main purpose of Mermaid is to help documentation catch up with development.

### 1. Trigger Syntax

To render a graph, output a code block with the language tag `plot-mermaid` containing a valid Mermaid object.

#### Example

```plot-mermaid
graph TD;
    A-->B;
    A-->C;
    B-->D;
    C-->D;
```
