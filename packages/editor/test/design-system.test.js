import assert from "node:assert/strict";
import { test } from "node:test";
import { contrastRatio, hexToRgb, readableOn } from "../src/lib/design-preview.js";
import {
  contrastGrade,
  designAntiPatterns,
  designComponentRules,
  designMotion,
  designRadiusScale,
  designShadowScale,
  designSpacingScale,
  designSummary,
  designTypeScale,
  groupDesignColors,
  parseDesignBody,
} from "../src/lib/design-system.js";

const FULL_META = {
  name: "airbnb-theme",
  colors: {
    background: "#ffffff",
    surface: "#f7f7f7",
    primary: "#ff385c",
    text: "#222222",
    muted: "#717171",
    border: "#dddddd",
    accent: "#00a699",
    destructive: "#c13515",
  },
  typography: {
    fontFamily: '"Geist Variable", sans-serif',
    scale: { h1: "32px", h2: "26px", h3: "18px", body: "16px", small: "14px" },
  },
  spacing: { unit: "8px", scale: ["4px", "8px", "16px", "24px", "40px"] },
  radius: { sm: "8px", md: "12px", full: "999px" },
  shadows: { sm: "0 1px 2px rgba(0,0,0,.06)", md: "0 16px 38px rgba(0,0,0,.09)", lg: "0 30px 72px rgba(0,0,0,.13)" },
  motion: { duration: "220ms", easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  components: {
    Button: { radius: "md", primaryVariant: "default" },
    Card: { surface: "surface", border: "optional", shadow: "contextual" },
  },
  antiPatterns: ["no-blue-purple-gradient", "no-three-equal-card-row"],
};

test("expands every hex form and rejects invalid values", () => {
  assert.deepEqual(hexToRgb("#fff"), [255, 255, 255]);
  assert.deepEqual(hexToRgb("#ff385c"), [255, 56, 92]);
  assert.deepEqual(hexToRgb("ff385cff"), [255, 56, 92]);
  assert.equal(hexToRgb("not-a-color"), null);
  assert.equal(hexToRgb(undefined), null);
});

test("computes WCAG contrast ratios and grades", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(Math.round(contrastRatio("#ffffff", "#ffffff")), 1);
  assert.equal(contrastGrade("#000000", "#ffffff").level, "AAA");
  assert.equal(contrastGrade("#767676", "#ffffff").level, "AA");
  assert.equal(contrastGrade("#949494", "#ffffff").level, "AA Large");
  assert.equal(contrastGrade("#f4f4f4", "#ffffff").level, "对比不足");
  assert.equal(contrastGrade("#f4f4f4", "#ffffff").tone, "fail");
});

test("picks a readable foreground for light and dark swatches", () => {
  assert.equal(readableOn("#ffffff"), "#18181b");
  assert.equal(readableOn("#222222"), "#ffffff");
});

test("groups colors by role and keeps declaration-driven usage copy", () => {
  const groups = groupDesignColors(FULL_META);
  assert.deepEqual(groups.map((group) => group.id), ["brand", "surface", "content"]);

  const brand = groups[0];
  assert.deepEqual(brand.items.map((item) => item.token), ["primary", "accent", "destructive"]);
  assert.equal(brand.items[0].value, "#ff385c");
  assert.equal(brand.items[0].usage, "主按钮、链接与选中态");
  assert.equal(brand.items[0].contrastAgainst, "页面底色");

  const surface = groups[1];
  assert.equal(surface.items[0].contrastAgainst, "文字色");
});

test("drops missing or malformed colors instead of rendering broken swatches", () => {
  const groups = groupDesignColors({
    colors: { primary: "#635bff", accent: "rgb(1,2,3)", background: "#ffffff", text: "#111111" },
  });
  assert.deepEqual(groups.map((group) => group.id), ["brand", "surface", "content"]);
  assert.deepEqual(groups[0].items.map((item) => item.token), ["primary"]);
  assert.deepEqual(groups[1].items.map((item) => item.token), ["background"]);
  assert.deepEqual(groups[2].items.map((item) => item.token), ["text"]);
});

test("collects colors outside the schema into an extras group", () => {
  const groups = groupDesignColors({
    colors: { primary: "#635bff", background: "#ffffff", brandInk: "#25224b" },
  });
  const extras = groups.find((group) => group.id === "extra");
  assert.ok(extras);
  assert.deepEqual(extras.items.map((item) => item.token), ["brandInk"]);
  assert.equal(extras.items[0].usage, "自定义角色");
});

test("orders the type scale from largest to smallest", () => {
  const scale = designTypeScale(FULL_META);
  assert.deepEqual(scale.map((entry) => entry.token), ["h1", "h2", "h3", "body", "small"]);
  assert.equal(scale[0].size, "32px");
  assert.deepEqual(designTypeScale({}), []);
});

test("annotates spacing steps with unit multiples and bar ratios", () => {
  const spacing = designSpacingScale(FULL_META);
  assert.equal(spacing.unit, "8px");
  assert.deepEqual(spacing.steps.map((step) => step.multiple), [0.5, 1, 2, 3, 5]);
  assert.equal(spacing.steps.at(-1).ratio, 1);
  assert.equal(spacing.steps[0].ratio, 0.1);
  assert.equal(designSpacingScale({}), null);
});

test("returns radius, shadow and motion tokens only when declared", () => {
  assert.deepEqual(designRadiusScale(FULL_META).map((entry) => entry.token), ["sm", "md", "full"]);
  assert.deepEqual(designShadowScale(FULL_META).map((entry) => entry.token), ["sm", "md", "lg"]);
  assert.deepEqual(designMotion(FULL_META), {
    duration: "220ms",
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });

  assert.deepEqual(designRadiusScale({ radius: { md: "14px" } }).map((entry) => entry.token), ["md"]);
  assert.deepEqual(designShadowScale({}), []);
  assert.equal(designMotion({}), null);
  assert.equal(designMotion({ motion: {} }), null);
});

test("flattens component conventions into labelled rules", () => {
  const rules = designComponentRules(FULL_META);
  assert.deepEqual(rules.map((entry) => entry.component), ["Button", "Card"]);
  assert.deepEqual(rules[0].rules, [
    { rule: "radius", label: "圆角", value: "md" },
    { rule: "primaryVariant", label: "主变体", value: "default" },
  ]);
  assert.deepEqual(designComponentRules({}), []);
});

test("reads anti patterns defensively", () => {
  assert.deepEqual(designAntiPatterns(FULL_META), [
    "no-blue-purple-gradient",
    "no-three-equal-card-row",
  ]);
  assert.deepEqual(designAntiPatterns({ antiPatterns: "nope" }), []);
});

test("parses the DESIGN.md body into sections without a markdown dependency", () => {
  const sections = parseDesignBody(`# DESIGN.md — airbnb-theme

## 设计原则
- 先从产品目标推导布局。
- 严格使用 token。

## 颜色（colors）
primary 用于主要行动点。
- 单页只保留一个主强调色。
`);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, "设计原则");
  assert.deepEqual(sections[0].items, ["先从产品目标推导布局。", "严格使用 token。"]);
  assert.equal(sections[1].title, "颜色（colors）");
  assert.deepEqual(sections[1].paragraphs, ["primary 用于主要行动点。"]);
  assert.deepEqual(sections[1].items, ["单页只保留一个主强调色。"]);
  assert.deepEqual(parseDesignBody(""), []);
  assert.deepEqual(parseDesignBody(undefined), []);
});

test("summarises token counts for the overview bar", () => {
  assert.deepEqual(designSummary(FULL_META), {
    fontFamily: '"Geist Variable", sans-serif',
    primary: "#ff385c",
    colorCount: 8,
    typeCount: 5,
    spacingCount: 5,
    radiusCount: 3,
    shadowCount: 3,
  });

  const empty = designSummary({});
  assert.equal(empty.fontFamily, "未声明字体");
  assert.equal(empty.primary, null);
  assert.equal(empty.colorCount, 0);
  assert.equal(empty.spacingCount, 0);
});
