import type { ReactNode } from "react";

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "code"; language: string; code: string };

type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; value: string }
  | { type: "emphasis"; value: string }
  | { type: "link"; label: string; href: string };

type MarkdownMessageProps = {
  content: string;
};

// 渲染模型回复的 Markdown 子集, 流式过程中也能容忍不完整语法.
export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="markdown-message">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

// 把 Markdown 文本拆成块级结构.
function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const language = fence[1] ?? "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim()
      });
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*+]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n").trim() });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && shouldContinueParagraph(lines[index] ?? "")) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n").trim() });
  }

  return blocks;
}

// 判断当前行是否仍属于同一个段落.
function shouldContinueParagraph(line: string) {
  if (!line.trim()) return false;
  return !/^```/.test(line) && !/^(#{1,3})\s+/.test(line) && !/^\s*[-*+]\s+/.test(line) && !/^\s*\d+[.)]\s+/.test(line) && !/^>\s?/.test(line);
}

// 渲染一个 Markdown 块.
function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  if (block.type === "heading") {
    const HeadingTag = `h${block.level}` as "h1" | "h2" | "h3";
    return <HeadingTag key={index}>{renderInline(block.text)}</HeadingTag>;
  }

  if (block.type === "quote") {
    return <blockquote key={index}>{renderMultilineInline(block.text)}</blockquote>;
  }

  if (block.type === "unordered-list") {
    return (
      <ul key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }

  if (block.type === "ordered-list") {
    return (
      <ol key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(item)}</li>
        ))}
      </ol>
    );
  }

  if (block.type === "code") {
    return (
      <pre key={index}>
        <code data-language={block.language || undefined}>{block.code}</code>
      </pre>
    );
  }

  return <p key={index}>{renderMultilineInline(block.text)}</p>;
}

// 渲染包含换行的行内内容.
function renderMultilineInline(text: string): ReactNode[] {
  return text.split("\n").flatMap((line, lineIndex) => {
    const nodes = renderInline(line);
    return lineIndex === 0 ? nodes : [<br key={`br-${lineIndex}`} />, ...nodes];
  });
}

// 渲染粗体, 斜体, 行内代码和链接.
function renderInline(text: string): ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    if (token.type === "code") return <code key={index}>{token.value}</code>;
    if (token.type === "strong") return <strong key={index}>{token.value}</strong>;
    if (token.type === "emphasis") return <em key={index}>{token.value}</em>;
    if (token.type === "link" && isSafeLink(token.href)) {
      return (
        <a key={index} href={token.href} target="_blank" rel="noreferrer">
          {token.label}
        </a>
      );
    }
    return <span key={index}>{token.type === "link" ? token.label : token.value}</span>;
  });
}

// 把一行文本拆成行内 token.
function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      tokens.push({ type: "text", value: text.slice(cursor, match.index) });
    }

    const value = match[0];
    if (value.startsWith("`")) {
      tokens.push({ type: "code", value: value.slice(1, -1) });
    } else if (value.startsWith("**")) {
      tokens.push({ type: "strong", value: value.slice(2, -2) });
    } else if (value.startsWith("*")) {
      tokens.push({ type: "emphasis", value: value.slice(1, -1) });
    } else {
      const link = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) tokens.push({ type: "link", label: link[1], href: link[2] });
    }

    cursor = match.index + value.length;
  }

  if (cursor < text.length) {
    tokens.push({ type: "text", value: text.slice(cursor) });
  }

  return tokens;
}

// 限制链接协议, 避免模型输出 file 或 javascript 链接.
function isSafeLink(href: string) {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}
