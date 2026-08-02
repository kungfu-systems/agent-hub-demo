#!/usr/bin/env python3
"""Capture and verify the installed Kungfu Agent Hub qualifier by exact argv."""

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

SHA40 = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
MAX_BYTES = 4 * 1024 * 1024
MAX_EVENTS = 10_000
COMMAND = "kungfu agent hub qualify --output-dir ./kungfu-agent-hub-check"
NON_AUTHORITIES = [
    "first-party-identity",
    "system-identity",
    "kfd-compliance",
    "product-system-metadata",
    "package-metadata",
    "registry-history",
    "scan-output",
    "standalone-generation",
]
RENDITIONS = (
    ("1080p", 150, 36),
    ("720p", 100, 28),
)


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


def read_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
        raise CaptureError(f"{label} must be a bounded regular JSON file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CaptureError(f"{label} is invalid: {error}") from error
    if not isinstance(value, dict):
        raise CaptureError(f"{label} must contain an object")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CaptureError(message)


def isolated_environment(home: Path) -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(home),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_STATE_HOME": str(home / ".local/state"),
        "KF_HOME": str(home / "kungfu"),
        "KF_CONFIG_HOME": str(home / "config"),
        "KF_RUNTIME_DIR": str(home / "kungfu/runtime"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "UTC",
        "CI": "true",
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
        "FORCE_COLOR": "3",
    }


def run_pty(argv: list[str], cwd: Path, env: dict[str, str], columns: int, rows: int) -> bytes:
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    process = subprocess.Popen(
        argv,
        cwd=cwd,
        env=env,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        start_new_session=True,
        close_fds=True,
    )
    os.close(slave)
    chunks: list[bytes] = []
    total = 0
    deadline = time.monotonic() + 60
    try:
        while True:
            reached_eof = False
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                raise CaptureError("Kungfu qualifier exceeded the 60-second outer bound")
            readable, _, _ = select.select([master], [], [], min(remaining, 0.1))
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
                    require(total <= MAX_BYTES, "terminal capture exceeds 4 MiB")
                    chunks.append(chunk)
                else:
                    reached_eof = True
            if process.poll() is not None and (not readable or reached_eof):
                break
        require(process.returncode == 0, f"Kungfu qualifier exited with {process.returncode}")
    finally:
        os.close(master)
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
    return b"".join(chunks)


def safe_terminal_text(raw: bytes, replacements: dict[str, str]) -> str:
    require(b"\0" not in raw, "terminal output contains NUL")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise CaptureError(f"terminal output is not UTF-8: {error}") from error
    for source, target in sorted(replacements.items(), key=lambda item: -len(item[0])):
        text = text.replace(source, target)
    private = (
        r"/home/runner/",
        r"/home/[^/\s]+/",
        r"/Users/[^/\s]+/",
        r"(?i)(token|password|secret|cookie)\s*=",
        r"(?i)authorization:\s*(?:bearer|basic)\s+\S+",
        r"\bgh[pousr]_[A-Za-z0-9]{20,}\b",
        r"\bgithub_pat_[A-Za-z0-9_]{20,}\b",
        r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----",
    )
    for pattern in private:
        require(re.search(pattern, text) is None, "terminal output contains a private path or credential-shaped value")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def terminal_capture(text: str, columns: int, rows: int, report_root: str) -> dict[str, Any]:
    header = f"\x1b[2J\x1b[H\x1b[38;5;42m{'━' * columns}\x1b[0m\r\n"
    prompt = f"\x1b[1;38;5;81m$\x1b[0m \x1b[1m{COMMAND}\x1b[0m\r\n"
    events = [{"atMs": 0, "data": base64.b64encode((header + prompt).encode()).decode()}]
    at_ms = 120
    for line in text.splitlines():
        data = f"{line}\r\n".encode("utf-8")
        if data.strip():
            events.append({"atMs": at_ms, "data": base64.b64encode(data).decode()})
            at_ms += 90
    require(1 <= len(events) <= MAX_EVENTS, "terminal event count is outside the contract")
    duration = max(500, at_ms + 250)
    require(duration <= 60_000, "terminal presentation exceeds 60 seconds")
    return {
        "schema": "kungfu.terminal-capture/v1",
        "command": COMMAND,
        "dimensions": {"columns": columns, "rows": rows},
        "durationMs": duration,
        "encoding": "base64",
        "events": events,
        "completion": {
            "schema": "kungfu.kfd-agent-hub-qualification/v1",
            "status": "qualified",
            "reportRoot": report_root,
            "eventCount": len(events),
        },
        "exitCode": 0,
        "authority": {
            "classification": "volatile-terminal-observation",
            "grants": [],
            "nonAuthorities": NON_AUTHORITIES,
        },
    }


def validate_qualification(
    qualification: dict[str, Any], verification: dict[str, Any], source_sha: str
) -> dict[str, Any]:
    product = qualification.get("product") or {}
    coverage = qualification.get("coverage") or {}
    isolation = qualification.get("isolation") or {}
    evidence = qualification.get("evidence") or {}
    checks = verification.get("checks") or []
    require(qualification.get("schema") == "kungfu.kfd-agent-hub-qualification/v1", "qualification schema mismatch")
    require(qualification.get("valid") is True and qualification.get("result") == "pass", "qualification did not pass")
    require(coverage.get("passed") == 20 and coverage.get("total") == 20, "qualification is not 20/20")
    require(qualification.get("kfd", {}).get("offline") is True, "qualification is not offline")
    require(isolation.get("realHomeUnchanged") is True, "real home isolation did not pass")
    require(product.get("sourceCommit") == source_sha, "Kungfu source commit mismatch")
    require(DIGEST.fullmatch(str(product.get("artifactDigest") or "")) is not None, "product artifact digest is invalid")
    require(DIGEST.fullmatch(str(evidence.get("reportDigest") or "")) is not None, "report digest is invalid")
    require(verification.get("schema") == "kungfu.kfd-agent-hub-qualification-verification/v1", "verification schema mismatch")
    require(verification.get("valid") is True and verification.get("result") == "pass", "independent verification did not pass")
    require(isinstance(checks, list) and checks and all(item.get("passed") is True for item in checks), "verification checks did not all pass")
    return {
        "schema": qualification["schema"],
        "valid": True,
        "result": "pass",
        "product": {
            key: product.get(key)
            for key in ("name", "version", "artifactDigest", "buildInfoDigest", "sourceCommit", "platform", "provenance")
        },
        "kfd": qualification.get("kfd"),
        "testedResponsibilities": qualification.get("testedResponsibilities"),
        "coverage": coverage,
        "meaning": qualification.get("meaning"),
        "nonClaims": qualification.get("nonClaims"),
        "isolation": {
            "topology": isolation.get("topology"),
            "realHomeUnchanged": True,
        },
        "evidence": {
            "reportDigest": evidence.get("reportDigest"),
            "verificationDigest": evidence.get("verificationDigest"),
        },
        "independentVerification": {
            "schema": verification["schema"],
            "valid": True,
            "result": "pass",
            "checks": [{"id": item.get("id"), "passed": True} for item in checks],
        },
    }


def copy_regular_tree(source: Path, target: Path) -> None:
    require(source.is_dir() and not source.is_symlink(), "source artifact root must be a directory")
    for path in source.rglob("*"):
        require(not path.is_symlink(), f"source artifact contains a symlink: {path.relative_to(source)}")
    shutil.copytree(source, target)


def capture_rendition(executable: Path, output: Path, source_sha: str, rendition_id: str, columns: int, rows: int) -> dict[str, Any]:
    directory = output / "renditions" / rendition_id
    directory.mkdir(parents=True)
    evidence_dir = directory / "kungfu-agent-hub-check"
    with tempfile.TemporaryDirectory(prefix=f"agent-hub-demo-{rendition_id}-") as home_value:
        home = Path(home_value)
        env = isolated_environment(home)
        raw = run_pty(
            [str(executable), "agent", "hub", "qualify", "--output-dir", "./kungfu-agent-hub-check"],
            directory,
            env,
            columns,
            rows,
        )
        qualification_path = evidence_dir / "qualification.json"
        qualification = read_object(qualification_path, "qualification")
        verify_result = subprocess.run(
            [str(executable), "agent", "hub", "verify", "--qualification-dir", str(evidence_dir), "--json"],
            cwd=directory,
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        require(verify_result.returncode == 0, f"independent verifier exited with {verify_result.returncode}")
        try:
            verification = json.loads(verify_result.stdout)
        except json.JSONDecodeError as error:
            raise CaptureError(f"independent verifier returned invalid JSON: {error}") from error
        require(isinstance(verification, dict), "independent verifier returned a non-object")
        public = validate_qualification(qualification, verification, source_sha)
        report_root = root_json(public)
        text = safe_terminal_text(
            raw,
            {
                str(evidence_dir.resolve()): "./kungfu-agent-hub-check",
                str(directory.resolve()): ".",
                str(home.resolve()): "<isolated-home>",
                str(executable.resolve()): "kungfu",
            },
        )
    shutil.rmtree(evidence_dir)
    capture = terminal_capture(text, columns, rows, report_root)
    (directory / "qualification-summary.json").write_text(stable_json(public), encoding="utf-8")
    (directory / "terminal-capture.json").write_text(stable_json(capture), encoding="utf-8")
    return {
        "id": rendition_id,
        "columns": columns,
        "rows": rows,
        "qualificationSummary": f"renditions/{rendition_id}/qualification-summary.json",
        "qualificationRoot": report_root,
        "terminalCapture": f"renditions/{rendition_id}/terminal-capture.json",
        "terminalCaptureRoot": root_json(capture),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kungfu", required=True)
    parser.add_argument("--kungfu-source-sha", required=True)
    parser.add_argument("--source-artifact", required=True)
    parser.add_argument("--source-coordinate", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    executable = Path(args.kungfu).resolve()
    source = Path(args.source_artifact).resolve()
    coordinate_path = Path(args.source_coordinate).resolve()
    output = Path(args.output).resolve()
    require(executable.is_file() and not executable.is_symlink() and os.access(executable, os.X_OK), "Kungfu executable must be a regular executable")
    require(SHA40.fullmatch(args.kungfu_source_sha) is not None, "Kungfu source SHA is invalid")
    require(not output.exists(), "capture output directory must be new")
    coordinate = read_object(coordinate_path, "source coordinate")
    require(coordinate.get("schema") == "buildchain.github-artifact-coordinate-set/v1", "source coordinate schema mismatch")
    require(isinstance(coordinate.get("artifacts"), list) and len(coordinate["artifacts"]) >= 1, "source coordinate has no artifacts")
    require(any(item.get("platformId") == "linux-x64" and DIGEST.fullmatch(str(item.get("digest") or "")) for item in coordinate["artifacts"]), "source coordinate has no exact Linux artifact")

    output.mkdir(parents=True)
    copy_regular_tree(source, output / "agent-hub-demo-artifact")
    (output / "source-coordinate.json").write_text(stable_json(coordinate), encoding="utf-8")
    renditions = [
        capture_rendition(executable, output, args.kungfu_source_sha, rendition_id, columns, rows)
        for rendition_id, columns, rows in RENDITIONS
    ]
    require(renditions[0]["terminalCaptureRoot"] != renditions[1]["terminalCaptureRoot"], "native rendition capture roots must differ")
    manifest = {
        "schema": "agent-hub-demo.auditable-demo-source/v1",
        "status": "qualified",
        "command": COMMAND,
        "kungfu": {
            "role": "external-qualification-and-recording-tool",
            "runtimeDependency": False,
            "sourceSha": args.kungfu_source_sha,
        },
        "sourceCoordinateRoot": root_json(coordinate),
        "renditions": renditions,
        "authority": {
            "classification": "capture-source-evidence",
            "grants": [],
            "nonAuthorities": ["first-party-identity", "system-identity", "kfd-compliance", "product-system-metadata", "package-metadata", "registry-history", "scan-output", "standalone-generation"],
        },
    }
    manifest["root"] = root_json(manifest)
    (output / "manifest.json").write_text(stable_json(manifest), encoding="utf-8")
    print(stable_json({"status": "qualified", "manifestRoot": manifest["root"], "output": str(output)}), end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (CaptureError, OSError, subprocess.SubprocessError) as error:
        print(f"capture-kungfu-agent-hub-demo: {error}", file=os.sys.stderr)
        raise SystemExit(1) from error
