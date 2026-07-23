export const releasePlatforms = [
  { artifact: "linux-x64", target: "linux-x64" },
  { artifact: "macos", target: "macos-arm64" },
  { artifact: "windows-x64", target: "windows-x64" },
];

export function matchesPayload(path, artifact, suffix) {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.includes(`agent-hub-demo-${artifact}-`) &&
    normalized.endsWith(suffix)
  );
}
