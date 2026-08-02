#!/usr/bin/env python3
"""Capture and verify the same-run Agent Hub Demo standalone binary."""

from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import json
import os
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path
from typing import Any

DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
COMMAND = "agent-hub-demo demo --root ./agent-hub-demo-run --output ./agent-hub-demo-run/report.json --presentation"
RENDITIONS = (("1080p", 150, 36), ("720p", 100, 28))
NON_AUTHORITIES = [
    "first-party-identity", "system-identity", "kfd-compliance",
    "product-system-metadata", "package-metadata", "registry-history",
    "scan-output", "standalone-generation",
]


class CaptureError(RuntimeError):
    pass


def stable_json(value: Any) -> str:
    def ordered(item: Any) -> Any:
        if isinstance(item, dict):
            return {key: ordered(item[key]) for key in sorted(item)}
        if isinstance(item, list):
            return [ordered(entry) for entry in item]
        return item
    return json.dumps(ordered(value), indent=2, ensure_ascii=False) + "\n"


def root_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def root_json(value: Any) -> str:
    return root_bytes(stable_json(value).encode("utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CaptureError(message)


def read_object(path: Path, label: str) -> dict[str, Any]:
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 8 * 1024 * 1024,
            f"{label} must be a bounded regular JSON file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CaptureError(f"{label} is invalid: {error}") from error
    require(isinstance(value, dict), f"{label} must contain an object")
    return value


def isolated_environment(home: Path) -> dict[str, str]:
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(home),
        "XDG_CACHE_HOME": str(home / ".cache"), "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_DATA_HOME": str(home / ".local/share"), "XDG_STATE_HOME": str(home / ".local/state"),
        "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TZ": "UTC", "CI": "true",
        "TERM": "xterm-256color", "COLORTERM": "truecolor", "FORCE_COLOR": "3",
    }


def run_pty(argv: list[str], cwd: Path, env: dict[str, str], columns: int, rows: int) -> bytes:
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave,
                               start_new_session=True, close_fds=True)
    os.close(slave)
    chunks: list[bytes] = []
    total = 0
    deadline = time.monotonic() + 60
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                raise CaptureError("Agent Hub Demo exceeded the 60-second outer bound")
            readable, _, _ = select.select([master], [], [], min(remaining, 0.1))
            eof = False
            if readable:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == 5:
                        chunk = b""
                    else:
                        raise
                if chunk:
                    total += len(chunk)
                    require(total <= 4 * 1024 * 1024, "terminal capture exceeds 4 MiB")
                    chunks.append(chunk)
                else:
                    eof = True
            if process.poll() is not None and (not readable or eof):
                break
        require(process.returncode == 0, f"Agent Hub Demo exited with {process.returncode}")
    finally:
        os.close(master)
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
    return b"".join(chunks)


def safe_text(raw: bytes, replacements: dict[str, str]) -> str:
    require(b"\0" not in raw, "terminal output contains NUL")
    text = raw.decode("utf-8", errors="strict")
    for source, target in sorted(replacements.items(), key=lambda item: -len(item[0])):
        text = text.replace(source, target)
    for pattern in (r"/home/runner/", r"/Users/[^/\s]+/", r"(?i)(token|password|secret|cookie)\s*=",
                    r"\bgh[pousr]_[A-Za-z0-9]{20,}\b", r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"):
        require(re.search(pattern, text) is None, "terminal output contains a private path or credential-shaped value")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def validate_binary(binary: Path, metadata: dict[str, Any]) -> dict[str, Any]:
    require(metadata.get("contract") == "agent-hub-demo.binary-artifact/v1", "binary metadata contract mismatch")
    require(metadata.get("platform") == "linux-x64", "binary metadata platform mismatch")
    require(metadata.get("runtimeDependencies") == [], "binary is not standalone")
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    require(metadata.get("sha256") == digest, "binary digest differs from Buildchain artifact metadata")
    with tempfile.TemporaryDirectory(prefix="agent-hub-demo-self-verify-") as home_value:
        result = subprocess.run([str(binary), "self-verify", "--json"], check=False, capture_output=True, text=True,
                                env=isolated_environment(Path(home_value)), timeout=60)
    require(result.returncode == 0, "standalone binary self-verification failed")
    verification = json.loads(result.stdout)
    require(verification.get("contract") == "agent-hub-demo.self-verification/v1" and verification.get("ok") is True,
            "standalone binary self-verification result is invalid")
    return {"schema": "agent-hub-demo.binary-identity/v1", "platform": "linux-x64",
            "sha256": f"sha256:{digest}", "selfVerification": verification}


def validate_report(report: dict[str, Any]) -> dict[str, Any]:
    results = report.get("results") or {}
    require(report.get("contract") == "agent-hub-demo.report/v1", "demo report contract mismatch")
    expected = {"fact": "admitted", "episode": "admitted", "conflict": "conflicted",
                "amplification": "rejected", "expired": "rejected", "revoked": "rejected",
                "unknownFeature": "rejected", "disclosureConflation": "rejected"}
    for name, status in expected.items():
        require(results.get(name, {}).get("status") == status, f"demo result {name} did not reach {status}")
    require(results.get("duplicate", {}).get("duplicate") is True, "duplicate was not idempotent")
    require(results.get("driftRejected") is True, "drifted bundle was not rejected")
    require(results.get("recovery", {}).get("importedObjects", 0) > 0, "recovery was not verified")
    return {"schema": "agent-hub-demo.capture-summary/v1", "status": "passed", "reportRoot": root_json(report),
            "results": expected, "duplicateIdempotent": True, "driftRejected": True,
            "recoveredObjects": results["recovery"]["importedObjects"]}


def terminal_capture(text: str, columns: int, rows: int, summary_root: str) -> dict[str, Any]:
    header = f"\x1b[2J\x1b[H\x1b[38;5;42m{'━' * columns}\x1b[0m\r\n"
    prompt = f"\x1b[1;38;5;81m$\x1b[0m \x1b[1m{COMMAND}\x1b[0m\r\n"
    events = [{"atMs": 0, "data": base64.b64encode((header + prompt).encode()).decode()}]
    at_ms = 140
    for line in text.splitlines():
        if line.strip():
            events.append({"atMs": at_ms, "data": base64.b64encode(f"{line}\r\n".encode()).decode()})
            at_ms += 120
    return {"schema": "agent-hub-demo.terminal-capture/v1", "command": COMMAND,
            "dimensions": {"columns": columns, "rows": rows}, "durationMs": max(900, at_ms + 400),
            "encoding": "base64", "events": events,
            "completion": {"schema": "agent-hub-demo.capture-summary/v1", "status": "passed",
                           "summaryRoot": summary_root, "eventCount": len(events)}, "exitCode": 0,
            "authority": {"classification": "volatile-terminal-observation", "grants": [],
                          "nonAuthorities": NON_AUTHORITIES}}


def capture_rendition(binary: Path, output: Path, rendition_id: str, columns: int, rows: int) -> dict[str, Any]:
    directory = output / "renditions" / rendition_id
    directory.mkdir(parents=True)
    run_root = directory / "agent-hub-demo-run"
    report_path = run_root / "report.json"
    with tempfile.TemporaryDirectory(prefix=f"agent-hub-demo-{rendition_id}-") as home_value:
        home = Path(home_value)
        raw = run_pty([str(binary), "demo", "--root", str(run_root), "--output", str(report_path),
                       "--presentation"], directory, isolated_environment(home), columns, rows)
        summary = validate_report(read_object(report_path, "demo report"))
        text = safe_text(raw, {str(run_root): "./agent-hub-demo-run", str(output): ".",
                               str(binary): "agent-hub-demo", str(home): "<isolated-home>"})
    shutil.rmtree(run_root)
    capture = terminal_capture(text, columns, rows, root_json(summary))
    (directory / "run-summary.json").write_text(stable_json(summary), encoding="utf-8")
    (directory / "terminal-capture.json").write_text(stable_json(capture), encoding="utf-8")
    return {"id": rendition_id, "columns": columns, "rows": rows,
            "runSummary": f"renditions/{rendition_id}/run-summary.json", "runSummaryRoot": root_json(summary),
            "terminalCapture": f"renditions/{rendition_id}/terminal-capture.json",
            "terminalCaptureRoot": root_json(capture)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--binary-metadata", required=True)
    parser.add_argument("--demo-config", required=True)
    parser.add_argument("--source-artifact", required=True)
    parser.add_argument("--source-coordinate", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    binary = Path(args.binary).resolve()
    source_artifact = Path(args.source_artifact).resolve()
    coordinate_path = Path(args.source_coordinate).resolve()
    output = Path(args.output).resolve()
    config = read_object(Path(args.demo_config).resolve(), "Buildchain demo config")
    require(config.get("schema") == "buildchain.binary-auditable-demo/v1", "demo config schema mismatch")
    require(config.get("product") == "agent-hub-demo", "demo config product mismatch")
    require(config.get("demo", {}).get("command") == COMMAND, "demo config command mismatch")
    require(config.get("demo", {}).get("deterministic") is True and config.get("demo", {}).get("network") == "not-required" and config.get("demo", {}).get("secrets") == "none", "demo config execution boundary mismatch")
    require([(item.get("id"), item.get("columns"), item.get("rows")) for item in config.get("renditions", [])] == list(RENDITIONS), "demo config rendition mismatch")
    require(binary.is_file() and not binary.is_symlink() and os.access(binary, os.X_OK),
            "Agent Hub Demo binary must be a regular executable")
    require(source_artifact.is_dir() and not source_artifact.is_symlink(), "source artifact root is invalid")
    require(binary.is_relative_to(source_artifact), "binary is outside the same-run artifact")
    require(Path(args.binary_metadata).resolve().is_relative_to(source_artifact), "binary metadata is outside the same-run artifact")
    require(not output.exists(), "capture output directory must be new")
    coordinate = read_object(coordinate_path, "source coordinate")
    require(coordinate.get("schema") == "buildchain.github-artifact-coordinate-set/v1", "source coordinate schema mismatch")
    require(any(item.get("platformId") == "linux-x64" and DIGEST.fullmatch(str(item.get("digest") or ""))
                for item in coordinate.get("artifacts", [])), "source coordinate has no exact Linux artifact")
    metadata = read_object(Path(args.binary_metadata).resolve(), "binary metadata")
    require(config.get("artifact", {}).get("metadataContract") == metadata.get("contract"), "demo config metadata contract mismatch")
    require(config.get("artifact", {}).get("runtimeDependencies") == [], "demo config requires runtime dependencies")
    binary_identity = validate_binary(binary, metadata)
    output.mkdir(parents=True)
    (output / "binary-identity.json").write_text(stable_json(binary_identity), encoding="utf-8")
    (output / "source-coordinate.json").write_text(stable_json(coordinate), encoding="utf-8")
    renditions = [capture_rendition(binary, output, *descriptor) for descriptor in RENDITIONS]
    require(renditions[0]["terminalCaptureRoot"] != renditions[1]["terminalCaptureRoot"],
            "native rendition capture roots must differ")
    manifest = {"schema": "agent-hub-demo.auditable-demo-source/v1", "status": "passed", "command": COMMAND,
                "product": {"name": "agent-hub-demo", "distribution": "standalone-binary",
                            "runtimeDependencies": [], "binary": binary_identity},
                "sourceCoordinateRoot": root_json(coordinate), "renditions": renditions,
                "authority": {"classification": "capture-source-evidence", "grants": [],
                              "nonAuthorities": NON_AUTHORITIES}}
    manifest["root"] = root_json(manifest)
    (output / "manifest.json").write_text(stable_json(manifest), encoding="utf-8")
    print(stable_json({"status": "passed", "manifestRoot": manifest["root"], "output": str(output)}), end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (CaptureError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        print(f"capture-agent-hub-demo: {error}", file=os.sys.stderr)
        raise SystemExit(1) from error
