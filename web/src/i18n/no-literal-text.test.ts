import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import type ts from "typescript";
import { describe, expect, it } from "vitest";

// Required, not imported: through Vite's transform the 9 MB compiler trips over its missing source map.
const typescript = createRequire(import.meta.url)("typescript") as typeof ts;

// Every word a screen shows goes through useT and the catalog (ADR 0038). This walks the .tsx under
// web/src and fails on a JSX text node, or a text attribute, written as a literal. "Text" means it has
// a letter in it: "·", "→", "…" pass on their own. What is left is the short list below — units and
// proper nouns, which read the same in every language. Add to it only what is not a sentence.
const ALLOWED = new Set([
  "Collie", "Collie Board", // the brand (ADR 0038: not translated)
  "ctx", "· ctx", "k", // the context gauge's unit: "62% · ctx", "48k"
  "shell", "sonnet", "main", "bug", "bun run test", "/home/you/code/project", // a program, a model, a branch, a tag, a command, a path — typed as is
  "Space", // a key on the keyboard, beside the bare "Esc" and "Tab" of the same pad
]);

// The attributes a person reads or hears; className, href, key… are not text.
const TEXT_ATTRS = new Set(["aria-label", "title", "placeholder", "alt"]);

const SRC = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx") ? [join(dir, e.name)] : [],
  );

const isText = (s: string) => /\p{L}/u.test(s) && !ALLOWED.has(s.trim());

// The literal text an expression can evaluate to: `"x"`, `` `x ${y}` ``, `a ? "x" : "y"`, `a && "x"`.
// A call (`t("key")`, `label(x)`) is not followed — what it returns is that function's business.
function pieces(e: ts.Expression): string[] {
  if (typescript.isStringLiteralLike(e)) return [e.text];
  if (typescript.isTemplateExpression(e)) return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)];
  if (typescript.isParenthesizedExpression(e)) return pieces(e.expression);
  if (typescript.isConditionalExpression(e)) return [...pieces(e.whenTrue), ...pieces(e.whenFalse)];
  if (typescript.isBinaryExpression(e)) return e.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken ? pieces(e.right) : [...pieces(e.left), ...pieces(e.right)];
  return [];
}

function literals(path: string): string[] {
  const source = typescript.createSourceFile(path, readFileSync(path, "utf8"), typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${relative(SRC, path)}:${line + 1} ${JSON.stringify(text)}`);
  };
  const visit = (node: ts.Node) => {
    if (typescript.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (isText(text)) report(node, text);
    } else if (typescript.isJsxExpression(node) && node.expression && (typescript.isJsxElement(node.parent) || typescript.isJsxFragment(node.parent))) {
      for (const text of pieces(node.expression)) if (isText(text)) report(node, text);
    } else if (typescript.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText(source)) && node.initializer) {
      const init = node.initializer;
      const texts = typescript.isStringLiteral(init) ? [init.text] : typescript.isJsxExpression(init) && init.expression ? pieces(init.expression) : [];
      for (const text of texts) if (isText(text)) report(node, text);
    }
    typescript.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the screens", () => {
  it("show no literal text — every string goes through useT and web/src/i18n/messages/", () => {
    expect(files(SRC).flatMap(literals)).toEqual([]);
  });
});
