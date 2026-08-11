import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function publicFiles(entry: string): Promise<string[]> {
  const absolute = path.join(root, entry);
  const statEntries = await readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const item of statEntries) {
    const relative = path.join(entry, item.name);
    if (item.isDirectory()) files.push(...await publicFiles(relative));
    else if (item.isFile()) files.push(relative);
  }
  return files;
}

describe("public plugin surface", () => {
  it("keeps package, Orca engine, API, and capabilities explicit", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const manifest = JSON.parse(await readFile(path.join(root, "orca-plugin.json"), "utf8"));
    const targets = JSON.parse(await readFile(path.join(root, "fixtures/default-targets.json"), "utf8"));

    expect(packageJson.version).toBe(manifest.version);
    expect(packageJson.engines).toEqual({ node: ">=22" });
    expect(packageJson.packageManager).toBe("npm@10.9.4");
    expect(manifest.engines).toEqual({ orca: ">=1.4.176" });
    expect(manifest.pluginApi).toBe(1);
    expect(Object.keys(manifest.contributes)).toEqual(["panels"]);
    expect(manifest.capabilities.map((capability: { kind: string }) => capability.kind)).toEqual([
      "workspace:read",
      "terminal:send",
      "notifications:show",
    ]);
    expect(targets.models.every((model: { reasoningLevels?: string[] }) => model.reasoningLevels?.length)).toBe(true);
    expect(targets.models.find((model: { id: string }) => model.id === "claude-opus-5").reasoningLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(targets.models.find((model: { id: string }) => model.id === "gpt-5.6-luna").reasoningLevels).not.toContain("ultra");
  });

  it("ships a reproducible gate and excludes generated or local runtime state", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const workflow = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
    const ignore = await readFile(path.join(root, ".gitignore"), "utf8");
    const packager = await readFile(path.join(root, "scripts/package-plugin.mjs"), "utf8");
    const verifier = await readFile(path.join(root, "scripts/verify-plugin-package.mjs"), "utf8");

    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("corepack enable");
    expect(workflow).toContain("corepack npm --version");
    expect(workflow).toContain("corepack npm@11.6.2");
    expect(workflow).toContain("corepack npm ci");
    expect(workflow).toContain("corepack npm run check");
    expect(workflow).toContain("corepack npm run package:plugin");
    expect(workflow).toContain("corepack npm run verify:plugin");
    expect(workflow).toContain("cmp");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(packageJson.scripts["package:plugin"]).toBe("node scripts/package-plugin.mjs");
    expect(packageJson.scripts["verify:plugin"]).toBe("node scripts/verify-plugin-package.mjs");
    expect(packageJson.devDependencies.tar).toBe("7.5.22");
    expect(packageJson.devDependencies.zod).toBe("4.4.3");
    expect(packager).not.toContain('execFileAsync("npm"');
    expect(packager).toContain("createCanonicalArchive");
    expect(packager).toContain("archive.writeUInt32LE(0, 4)");
    expect(verifier).not.toContain("ORCA_GRAPH_SKIP_REBUILD");
    expect(verifier).toContain("saveCli: \"saved\"");
    expect(workflow).toContain("no-install plugin bootstrap/save");
    expect(packageJson.files).not.toContain("runtime/");
    if (packageJson.private === true) {
      expect(packageJson.files).toContain("dist/");
      expect(packageJson.files).toContain("npm-shrinkwrap.json");
      expect(packageJson.files).toContain(".github/");
    } else {
      expect(packageJson.files).not.toContain("dist/");
    }
    expect(packageJson.files).not.toContain("docs/");
    expect(packageJson.files).toContain("docs/architecture.md");
    expect(ignore).toContain("runtime/");
    expect(ignore).toContain("dist/");
    expect(ignore).toContain("release/");
    await expect(readFile(path.join(root, "CONTRIBUTING.md"), "utf8")).resolves.toContain("npm run check");
    await expect(readFile(path.join(root, "SECURITY.md"), "utf8")).resolves.toContain("Reporting a vulnerability");
  });

  it("does not regress to private-service names, secrets, or absolute contributor paths", async () => {
    // 테스트 픽스처도 공개된다. 여기 개인 장치 이름이 남으면 그것도 결합이다.
    const roots = ["docs", "fixtures", "lib", "scripts", "src", "tests"];
    const files = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "orca-plugin.json", "package.json"];
    for (const directory of roots) files.push(...await publicFiles(directory));
    const forbidden = [
      ["under", "joy"].join(""),
      ["under", "claw"].join("-"),
      ["work", "tasks"].join("-"),
      ["work", "tasks"].join("_"),
      ["ff", "genius"].join("-"),
      ["her", "mes"].join(""),
      ["jsj", "1"].join(""),
      ["jsj", "2"].join(""),
      ["정석", "맥"].join(""),
    ];
    const findings: string[] = [];
    for (const file of files) {
      // 파일 이름도 결합이다. 내용만 훑으면 사설 서비스 이름이 파일명으로 남는다.
      for (const term of forbidden) if (file.toLowerCase().includes(term)) findings.push(`${file}: private coupling in the file name`);
      const content = await readFile(path.join(root, file), "utf8");
      for (const term of forbidden) if (content.toLowerCase().includes(term)) findings.push(`${file}: private coupling`);
      if (/\/Users\/[^/]+|[A-Za-z]:\\Users\\/u.test(content)) findings.push(`${file}: absolute user path`);
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(content)) findings.push(`${file}: private key`);
    }
    expect(findings).toEqual([]);
  });

  it("keeps the panel honest about what it can observe after dispatch", async () => {
    const panel = await readFile(path.join(root, "src/panel.ts"), "utf8");
    // 패널에는 세션에서 돌아오는 채널이 없다. 진행률이나 완료를 지어내면 사용자는
    // 실제로는 확인되지 않은 상태를 사실로 읽는다.
    expect(panel).toContain("전달 뒤의 진행은 각 세션에서 확인하십시오");
    expect(panel).not.toContain("executionActive");
  });

  it("keeps the save path free of a resident helper process", async () => {
    const cli = await readFile(path.join(root, "scripts/graph-store.mjs"), "utf8");
    const panel = await readFile(path.join(root, "src/panel.ts"), "utf8");
    // 상주 프로세스를 되살리면 사용자가 다시 그것을 관리해야 한다.
    expect(cli).toContain("상주 프로세스가 아니다");
    expect(cli).not.toContain("http.createServer");
    expect(cli).not.toContain("process.stdin");
    // 넓게 보기용 loopback 응답 채널이 되살아나는 것을 막는다. 데이터 원천 URL
    // 입력의 예시 값은 사용자가 직접 넣는 주소이므로 여기 해당하지 않는다.
    expect(panel).not.toContain("fetch(");
    expect(panel).not.toContain("__ORCA_GRAPH_WIDE_API__");
  });

  it("sends every panel write through the one host action Orca allows", async () => {
    const panel = await readFile(path.join(root, "src/panel.ts"), "utf8");
    // 패널이 밖으로 나가는 통로는 terminal.sendText 하나뿐이다. 다른 경로가 생기면
    // 그것은 Orca가 막아 둔 것을 우회한 것이거나, 동작하지 않는 코드다.
    const hostCalls = [...panel.matchAll(/hostCall<[^>]*>\("([a-zA-Z.]+)"/gu)].map((match) => match[1]);
    const inlineCalls = [...panel.matchAll(/hostCall\("([a-zA-Z.]+)"/gu)].map((match) => match[1]);
    expect([...new Set([...hostCalls, ...inlineCalls])].sort()).toEqual([
      "notifications.show", "terminal.sendText", "workspace.readContext",
    ]);
  });

  it("keeps the complete panel type scale on D2Coding at the enlarged sizes", async () => {
    const css = await readFile(path.join(root, "src/panel.css"), "utf8");
    const families = [...css.matchAll(/font-family:\s*([^;]+);/gu)].map((match) => match[1]?.trim());
    expect(families).toEqual(['"D2Coding", monospace', '"D2Coding", monospace']);

    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/gu)].map((match) => Number(match[1]));
    expect(Object.fromEntries([...new Set(sizes)].sort((left, right) => left - right)
      .map((size) => [size, sizes.filter((value) => value === size).length]))).toEqual({
      9: 1, 10: 8, 11: 33, 12: 51, 13: 5, 14: 1, 15: 1, 16: 1, 17: 3, 18: 5,
    });
  });
});
