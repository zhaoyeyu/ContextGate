import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const self = resolve(import.meta.filename);
const excludedDirectories = new Set([".git", "node_modules", "dist", "evaluation-output"]);
const textExtensions = new Set([".json", ".md", ".mjs", ".js", ".py", ".ts", ".yaml", ".yml"]);
const publicFiles = collectFiles(root).filter(
  (file) => resolve(file) !== self && (textExtensions.has(extname(file)) || file.endsWith("LICENSE"))
);
const forbidden = [
  ["local Windows path", /[A-Za-z]:[\\/](?:Users|myproject|workspace|repos?)[\\/]/i],
  ["local Unix home path", /\/(?:home|Users)\/[A-Za-z0-9._-]+\//],
  ["internal audit workspace", /(?:_github_portfolio_audit|portfolio-upgrade-[0-9]+|run-[0-9]{8})/i],
  ["internal release decisions", /Repository And Release Decisions/i],
  ["provider budget instructions", /(remaining provider budget|budget guidance|budget is limited)/i]
];

const findings = [];
for (const file of publicFiles) {
  const source = readFileSync(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) findings.push(`${relative(root, file)}: ${label}`);
  }
}

if (findings.length) {
  console.error(`Public-boundary check failed:\n${findings.join("\n")}`);
  process.exit(1);
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
