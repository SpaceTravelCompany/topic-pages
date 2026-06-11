#!/usr/bin/env node
/**
 * Dev 워크플로우: 빌드 + live-server로 서빙 + 자동 새로고침.
 *
 * 사용법:
 *   node scripts/dev.mjs [build 옵션...]
 *   topic-pages dev [build 옵션...]
 *
 * 동작:
 *   1. 첫 빌드
 *   2. live-server로 dist/ 서빙
 *   3. content/, site.json 변경 감지 → 자동 재빌드
 *      → dist/ 갱신 → live-server가 변경 감지 → 브라우저 자동 새로고침
 *
 * 종료: Ctrl+C. live-server shutdown + 종료 코드 0.
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const buildScript = path.join(__dirname, "build.mjs");

// argv에서 --out 파싱 + build.mjs에 그대로 전달할 인자
const argv = process.argv.slice(2);
let outDir = path.join(process.cwd(), "dist");
const buildArgs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out" && argv[i + 1]) {
    outDir = path.resolve(argv[++i]);
    buildArgs.push("--out", outDir);
  } else {
    buildArgs.push(argv[i]);
  }
}

let isBuilding = false;
let pendingRebuild = false;

function runBuild() {
  if (isBuilding) {
    pendingRebuild = true;
    return Promise.resolve();
  }
  isBuilding = true;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [buildScript, ...buildArgs], {
      stdio: "inherit",
    });
    child.on("exit", () => {
      isBuilding = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        setTimeout(() => runBuild().then(resolve), 100);
      } else {
        resolve();
      }
    });
    child.on("error", () => {
      isBuilding = false;
      resolve();
    });
  });
}

async function startLiveServer(distDir) {
  let mod;
  try {
    mod = await import("live-server");
  } catch (err) {
    console.error("");
    console.error("  오류: 'live-server' 패키지를 찾을 수 없습니다.");
    console.error("  topic-pages를 다시 설치하세요:");
    console.error("    npm install");
    console.error("  또는 전역 설치 후 PATH에 추가:");
    console.error("    npm install -g live-server");
    console.error("");
    process.exit(1);
  }

  const liveServer = mod.default || mod;
  if (typeof liveServer.start !== "function") {
    console.error("  오류: 'live-server' API를 사용할 수 없습니다.");
    process.exit(1);
  }

  const port = Number(process.env.PORT) || 4321;
  const host = process.env.HOST || "127.0.0.1";

  const params = {
    port,
    host,
    root: distDir,
    open: false,
    wait: 100,
    logLevel: 1,
    file: "index.html", // SPA: 404 → index.html
  };

  liveServer.start(params);
  console.log("");
  console.log(`  Dev server: http://${host}:${port}`);
  console.log(`  Serving:    ${distDir}`);
  console.log(`  Watching:   content/, site.json (Ctrl+C to stop)`);
  console.log("");

  return liveServer;
}

async function shutdown(liveServer) {
  if (liveServer && typeof liveServer.shutdown === "function") {
    try {
      liveServer.shutdown();
    } catch {
      // 무시
    }
  }
  process.exit(0);
}

async function watchInputs() {
  const cwd = process.cwd();
  const targets = ["content", "site.json"];

  for (const target of targets) {
    const abs = path.join(cwd, target);
    try {
      const watcher = watch(abs, { recursive: true });
      (async () => {
        for await (const _ of watcher) {
          runBuild();
        }
      })();
    } catch (err) {
      // 디렉토리/파일이 없으면 무시 (선택적 입력)
    }
  }
}

async function main() {
  console.log("Building...");
  await runBuild();
  console.log("Build done.\n");

  const liveServer = await startLiveServer(outDir);

  await watchInputs();

  process.on("SIGINT", () => shutdown(liveServer));
  process.on("SIGTERM", () => shutdown(liveServer));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
