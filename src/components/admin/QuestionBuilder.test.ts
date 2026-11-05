import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminQuestionsPage, { metadata } from "@/app/admin/questions/page";
import { QuestionBuilder, stableJson } from "./QuestionBuilder";

describe("admin Question Builder page", () => {
  it("is kept out of search indexes", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("server-renders only the shell: no questions, answers or forms before the session check", () => {
    const html = renderToStaticMarkup(createElement(AdminQuestionsPage));
    expect(html).toContain("Question Builder");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<table");
    expect(html).not.toMatch(/Valid answers|Plákata pick|Your questions/);
    expect(renderToStaticMarkup(createElement(QuestionBuilder))).toBe(html);
  });

  it("compares saved criteria regardless of key order (Postgres jsonb reorders keys)", () => {
    expect(stableJson({ type: "stat_threshold", stat: "homeRuns", value: 300 })).toBe(stableJson({ value: 300, type: "stat_threshold", stat: "homeRuns" }));
    expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 }));
    expect(stableJson({ a: [1, { y: 2, x: 1 }] })).toBe(stableJson({ a: [1, { x: 1, y: 2 }] }));
  });
});
