import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const root = process.cwd();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function platformId() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "macos-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "windows-x64";
  }
  throw new Error(
    `unsupported release binary platform: ${process.platform}-${process.arch}`,
  );
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export async function buildBinary() {
  if (Number(process.versions.node.split(".")[0]) < 24) {
    throw new Error("standalone binary builds require Node.js 24 or newer");
  }
  const platform = platformId();
  const work = resolve(root, ".buildchain/sea", platform);
  const entry = resolve(work, "agent-hub-demo.cjs");
  const blob = resolve(work, "agent-hub-demo.blob");
  const config = resolve(work, "sea-config.json");
  const extension = process.platform === "win32" ? ".exe" : "";
  const output = resolve(root, "dist", `agent-hub-demo-${platform}${extension}`);
  mkdirSync(work, { recursive: true });
  mkdirSync(dirname(output), { recursive: true });

  await build({
    entryPoints: [resolve(root, "src/cli.js")],
    outfile: entry,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node24",
    sourcemap: false,
    define: {
      "import.meta.url": JSON.stringify("sea://agent-hub-demo"),
    },
    banner: { js: "globalThis.__AGENT_HUB_DEMO_SEA__ = true;" },
  });
  writeFileSync(
    config,
    `${JSON.stringify(
      {
        main: entry,
        output: blob,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    )}\n`,
  );
  run(process.execPath, ["--experimental-sea-config", config]);
  copyFileSync(process.execPath, output);
  if (process.platform !== "win32") chmodSync(output, 0o755);
  if (process.platform === "darwin") {
    spawnSync("codesign", ["--remove-signature", output], {
      cwd: root,
      encoding: "utf8",
    });
  }
  run(process.execPath, [
    resolve(root, "node_modules/postject/dist/cli.js"),
    output,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    "--macho-segment-name",
    "NODE_SEA",
  ]);
  if (process.platform === "darwin") {
    run("codesign", ["--sign", "-", "--force", output]);
  }

  const version = run(output, ["version", "--json"]);
  const selfVerify = run(output, ["self-verify", "--json"]);
  const capabilities = run(output, [
    "capabilities",
    "--root",
    resolve(work, "capabilities"),
    "--json",
  ]);
  const checks = [version, selfVerify, capabilities].map((result) =>
    JSON.parse(result.stdout),
  );
  if (checks[1].ok !== true || checks[2].hubs?.length !== 2) {
    throw new Error("standalone binary smoke verification failed");
  }

  const outputSha256 = sha256(output);
  const outputPath = `dist/${basename(output)}`;
  const metadata = {
    schemaVersion: 1,
    contract: "agent-hub-demo.binary-artifact/v1",
    platform,
    file: outputPath,
    sha256: outputSha256,
    size: readFileSync(output).byteLength,
    node: process.version,
    runtimeDependencies: [],
    executableFiles: [{ path: outputPath, sha256: outputSha256 }],
    smoke: {
      version: checks[0],
      selfVerify: checks[1],
      hubCount: checks[2].hubs.length,
    },
  };
  const metadataPath = resolve(
    root,
    ".buildchain/artifacts",
    `binary-${platform}.json`,
  );
  mkdirSync(dirname(metadataPath), { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(`${output}.sha256`, `${metadata.sha256}  ${basename(output)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      status: "built",
      platform,
      binary: relative(root, output),
      sha256: metadata.sha256,
      metadata: relative(root, metadataPath),
    })}\n`,
  );
  return metadata;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildBinary().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
