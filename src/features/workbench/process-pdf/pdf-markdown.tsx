import { Fragment } from "react";
import { Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { COLORS } from "./pdf-theme";

type TextStyle = Style | Style[];

// A deliberately small markdown renderer for the rolling process summary.
// It mirrors the subset that markdown-summary.tsx renders on the web:
// `##`/`###` headings, `**bold**`, unordered (`-`/`*`) and ordered (`1.`)
// lists, and paragraphs. Anything fancier degrades gracefully to plain text.

type InlineRun = { text: string; bold: boolean };

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const regex = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    runs.push({ text: match[1] ?? match[2] ?? "", bold: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex), bold: false });
  }
  return runs.length > 0 ? runs : [{ text, bold: false }];
}

function InlineText({ text, style }: { text: string; style?: TextStyle }) {
  return (
    <Text style={style}>
      {parseInline(text).map((run, i) => (
        <Fragment key={i}>
          {run.bold ? (
            <Text style={{ fontFamily: "Helvetica-Bold", color: COLORS.ink }}>
              {run.text}
            </Text>
          ) : (
            run.text
          )}
        </Fragment>
      ))}
    </Text>
  );
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", text: heading[1].trim() });
      continue;
    }

    const unordered = trimmed.match(/^[-*•]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ul") last.items.push(unordered[1].trim());
      else blocks.push({ kind: "ul", items: [unordered[1].trim()] });
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ol") last.items.push(ordered[1].trim());
      else blocks.push({ kind: "ol", items: [ordered[1].trim()] });
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

export function PdfMarkdown({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <View>
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <Text
              key={i}
              style={{
                fontFamily: "Helvetica-Bold",
                fontSize: 9,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: COLORS.ink,
                marginTop: i === 0 ? 0 : 9,
                marginBottom: 3,
              }}
            >
              {block.text}
            </Text>
          );
        }

        if (block.kind === "ul" || block.kind === "ol") {
          return (
            <View key={i} style={{ marginVertical: 3, paddingLeft: 2 }}>
              {block.items.map((item, j) => (
                <View
                  key={j}
                  style={{ flexDirection: "row", marginBottom: 2.5 }}
                >
                  <Text
                    style={{
                      width: block.kind === "ol" ? 14 : 9,
                      fontSize: 9,
                      color: block.kind === "ol" ? COLORS.accent : COLORS.faint,
                      fontFamily:
                        block.kind === "ol" ? "Helvetica-Bold" : "Helvetica",
                    }}
                  >
                    {block.kind === "ol" ? `${j + 1}.` : "•"}
                  </Text>
                  <InlineText
                    text={item}
                    style={{
                      flex: 1,
                      fontSize: 9.5,
                      color: COLORS.body,
                      lineHeight: 1.45,
                    }}
                  />
                </View>
              ))}
            </View>
          );
        }

        return (
          <InlineText
            key={i}
            text={block.text}
            style={{
              fontSize: 9.5,
              color: COLORS.body,
              lineHeight: 1.55,
              marginBottom: 5,
            }}
          />
        );
      })}
    </View>
  );
}
