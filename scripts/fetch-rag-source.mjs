#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourcesPath = path.join(root, "rag", "sources.json");

function usage() {
  console.log(`Usage:
  node scripts/fetch-rag-source.mjs
  node scripts/fetch-rag-source.mjs <source-id>

Reads rag/sources.json and writes Markdown snapshots for RAG use.`);
}

function readerUrl(source) {
  if (source.reader !== "jina") {
    throw new Error(`Unsupported reader "${source.reader}" for ${source.id}`);
  }

  return `https://r.jina.ai/${source.url}`;
}

function trimToStartLine(markdown, startAtLine) {
  if (!startAtLine) return markdown;

  const lines = markdown.split(/\r?\n/);
  const normalizedStart = startAtLine.trim().replace(/\s+/g, " ");
  const index = lines.findIndex((line) => line.trim().replace(/\s+/g, " ") === normalizedStart);
  if (index === -1) {
    throw new Error(`Could not find startAtLine: ${startAtLine}`);
  }

  return lines.slice(index).join("\n");
}

function cleanup(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "Copy Page")
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd();
}

async function fetchMarkdown(source) {
  const url = readerUrl(source);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "codex-link-rag-fetcher/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${source.id}: ${response.status} ${response.statusText}`);
  }

  const fetchedAt = new Date().toISOString();
  let markdown = await response.text();
  markdown = trimToStartLine(markdown, source.startAtLine);
  markdown = cleanup(`${source.prepend ?? ""}${markdown}`);

  return `<!--
source_id: ${source.id}
source_url: ${source.url}
reader: ${source.reader}
reader_url: ${url}
fetched_at: ${fetchedAt}
-->

${markdown}
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    return;
  }

  const config = JSON.parse(await readFile(sourcesPath, "utf8"));
  const wanted = new Set(args);
  const sources = wanted.size === 0
    ? config.sources
    : config.sources.filter((source) => wanted.has(source.id));

  if (sources.length === 0) {
    throw new Error(`No matching sources for: ${args.join(", ")}`);
  }

  for (const source of sources) {
    const outputPath = path.join(root, source.output);
    const markdown = await fetchMarkdown(source);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown, "utf8");
    console.log(`wrote ${source.output}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
