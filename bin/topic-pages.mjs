#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptsDir = path.join(__dirname, "..", "scripts");

// subcommand: "dev" → dev.mjs, 그 외(또는 없음) → build.mjs
const [, , subcommand, ...rest] = process.argv;
const scriptName = subcommand === "dev" ? "dev.mjs" : "build.mjs";
const scriptPath = path.join(scriptsDir, scriptName);

// import한 스크립트에서 process.argv.slice(2)가 사용자 인자만 보도록 조정
process.argv = ["node", scriptPath, ...rest];

await import(pathToFileURL(scriptPath).href);
