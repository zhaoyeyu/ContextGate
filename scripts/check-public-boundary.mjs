import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicFiles = [
  join(root, "README.md"),
  ...readdirSync(join(root, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(root, "docs", name))
];
const forbidden = [
  ["local Windows project path", /[A-Za-z]:[\\/](?:myproject|Users)[\\/]/],
  ["local Unix home path", /\/home\/[A-Za-z0-9._-]+\//],
  ["internal release decisions", /Repository And Release Decisions/i],
  ["provider budget instructions", /(remaining provider budget|budget guidance|budget is limited)/i]
];

const findings = [];
for (const file of publicFiles) {
  const text = readFileSync(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(text)) findings.push(`${relative(root, file)}: ${label}`);
  }
}

if (findings.length) {
  console.error(`Public-boundary check failed:\n${findings.join("\n")}`);
  process.exit(1);
}
