#!/usr/bin/env node
/*
 * Graph Engineering 저장 CLI — 상주 프로세스가 아니다.
 *
 * Orca 플러그인 패널은 sandbox="allow-scripts" iframe에 `connect-src 'none'`
 * CSP로 갇혀 있어 네트워크도 파일도 브라우저 저장소도 쓸 수 없고, 플러그인
 * 워커와 통신할 채널도 없다. 패널이 밖으로 나가는 유일한 통로가
 * `terminal.sendText`이므로 저장은 이 CLI 한 줄을 터미널에 보내 수행한다.
 *
 * 호출당 한 번 돌고 끝난다. 포트도, 토큰도, 연결 상태도 없다.
 *
 *   graph-store.mjs save <payload>    변경분을 원천 또는 로컬 파일에 저장
 *   graph-store.mjs dispatch <payload> Task·Graph를 Orca 세션으로 내보내기
 *   graph-store.mjs source <payload>  데이터 원천 설정을 바꾸고 다시 읽기
 *   graph-store.mjs refresh           원천과 Orca 대상을 다시 읽기
 *
 * <payload>는 JSON을 gzip으로 압축한 뒤 base64url로 인코딩한 값이다. 패널이
 * 보낼 수 있는 텍스트가 4096자로 제한되어 있어 압축 없이는 큰 Task 하나도
 * 한 줄에 담기지 않는다.
 */
import { gunzipSync } from "node:zlib";
import { dispatchWorkItem } from "../lib/dispatch.mjs";
import { refreshTargets } from "../lib/orca.mjs";
import { prepareRuntime } from "../lib/paths.mjs";
import { configureSource, recordDispatch, refreshSource, saveChanges, writePanelSnapshot } from "../lib/store.mjs";

function decodePayload(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("payload is required");
  const compressed = Buffer.from(value.trim(), "base64url");
  return JSON.parse(gunzipSync(compressed).toString("utf8"));
}

function report(lines) {
  for (const line of lines) console.log(line);
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  await prepareRuntime();

  switch (command) {
    case "save": {
      const result = await saveChanges(decodePayload(argument));
      await writePanelSnapshot();
      report([
        `저장 완료 (${result.mode})`,
        ...result.warnings.map((warning) => `경고: ${warning}`),
      ]);
      return;
    }
    case "dispatch": {
      const record = await dispatchWorkItem(decodePayload(argument));
      await recordDispatch(record);
      await writePanelSnapshot();
      report([
        record.error
          ? `일부 대상에 전달하지 못했습니다: ${record.error}`
          : `${record.targets.length}개 세션에 작업을 보냈습니다.`,
        ...record.targets.map((target) =>
          `  → ${target.projectName || target.label}${target.branch ? ` · ${target.branch}` : ""} · ${target.opened === "new-session" ? "새 세션" : "기존 세션"}`),
      ]);
      if (record.error && !record.targets.length) process.exitCode = 1;
      return;
    }
    case "source": {
      const result = await configureSource(decodePayload(argument));
      await writePanelSnapshot();
      report([`데이터 원천 설정 완료 (${result.dataSource.config.mode} · ${result.dataSource.status})`]);
      return;
    }
    case "refresh": {
      const [source] = await Promise.allSettled([refreshSource(), refreshTargets()]);
      if (source.status === "rejected") throw source.reason;
      await writePanelSnapshot();
      report([`다시 읽었습니다 (${source.value.dataSource.config.mode} · ${source.value.dataSource.status})`]);
      return;
    }
    default:
      throw new Error(`unknown command: ${command ?? "(none)"}\nusage: graph-store.mjs <save|dispatch|source|refresh> [payload]`);
  }
}

main()
  .then(() => console.log("패널을 다시 열면 반영됩니다."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
