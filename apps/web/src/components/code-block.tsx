import type { ReactNode } from "react";

type Token = { text: string; cls?: string };

const KEYWORDS = new Set([
  "import", "from", "export", "const", "let", "var", "function", "return", "await", "async", "new", "if", "else", "for", "of", "in",
  "true", "false", "null", "undefined", "type", "interface", "class", "extends", "throw", "try", "catch", "default", "as",
]);

/** Minimal, safe tokenizer for TypeScript/JSON/shell snippets. Output is React text nodes; nothing is injected as HTML. */
function tokenize(code: string, lang: string): Token[] {
  const tokens: Token[] = [];
  const re =
    lang === "bash" || lang === "sh"
      ? /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([^\s"'#]+)|(\s+)/g
      : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:=<>+\-*/!?&|]+)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const [text, cm, str, num, word, pn] = m;
    if (cm) tokens.push({ text, cls: "tok-cm" });
    else if (str) tokens.push({ text, cls: "tok-str" });
    else if (num) tokens.push({ text, cls: "tok-num" });
    else if (word && (lang === "bash" || lang === "sh")) {
      tokens.push({ text, cls: text.startsWith("-") ? "tok-pn" : undefined });
    } else if (word) tokens.push({ text, cls: KEYWORDS.has(word) ? "tok-kw" : undefined });
    else if (pn) tokens.push({ text, cls: "tok-pn" });
    else tokens.push({ text });
  }
  return tokens;
}

export function CodeBlock({
  code,
  lang = "ts",
  title,
  className = "",
}: {
  code: string;
  lang?: "ts" | "bash" | "json" | "text";
  title?: string;
  className?: string;
}) {
  const tokens = lang === "text" ? [{ text: code }] : tokenize(code, lang);
  const body: ReactNode = tokens.map((t, i) => (t.cls ? <span key={i} className={t.cls}>{t.text}</span> : <span key={i}>{t.text}</span>));
  return (
    <figure className={`min-w-0 ${className}`}>
      {title ? <figcaption className="mb-1.5 font-mono text-xs text-fg-faint">{title}</figcaption> : null}
      <pre className="code-block" tabIndex={0} aria-label={title ? `${title} code` : `${lang} code`}>
        <code>{body}</code>
      </pre>
    </figure>
  );
}
