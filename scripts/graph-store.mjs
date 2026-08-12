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
 *   graph-store.mjs focus <handle>    실행한 Orca 세션 탭을 앞으로 가져오기
 *
 * <payload>는 JSON을 gzip으로 압축한 뒤 base64url로 인코딩한 값이다. 패널이
 * 보낼 수 있는 텍스트가 4096자로 제한되어 있어 압축 없이는 큰 Task 하나도
 * 한 줄에 담기지 않는다.
 */
import { gunzipSync } from "node:zlib";
import { dispatchWorkItem } from "../lib/dispatch.mjs";
import { ensureSaveTerminal, ensureTargets, refreshTargets, runOrca } from "../lib/orca.mjs";
import { prepareRuntime } from "../lib/paths.mjs";
import { configureSource, recordDispatch, recordSaveTerminal, refreshDispatchOutcomes, refreshSource, saveChanges, writePanelSnapshot } from "../lib/store.mjs";

function decodePayload(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("payload is required");
  const compressed = Buffer.from(value.trim(), "base64url");
  return JSON.parse(gunzipSync(compressed).toString("utf8"));
}

function report(lines) {
  for (const line of lines) console.log(line);
}

/** Orca 대상 갱신 결과를 그대로 보고한다. 삼키면 패널의 빈 목록이 설명되지 않는다. */
function targetsLine(result) {
  if (result.status === "rejected") {
    const reason = (result.reason instanceof Error ? result.reason.message : String(result.reason)).split("\n")[0];
    return `경고: Orca 대상을 읽지 못했습니다 — ${reason}`;
  }
  const { projects = [], branches = [], sessions = [] } = result.value ?? {};
  return `Orca 대상 · 프로젝트 ${projects.length} · 워크트리 ${branches.length} · 세션 ${sessions.length}`;
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  await prepareRuntime();
  // 새로 설치한 장치에는 Orca 대상 파일이 없다. 그대로 두면 패널이 빈 기본값을
  // 싣고 열려 실행할 프로젝트도 세션도 고를 수 없으므로, 첫 명령에서 한 번 읽는다.
  if (command !== "refresh" && !await ensureTargets()) {
    console.error("경고: Orca 대상을 읽지 못했습니다. 패널의 프로젝트·워크트리·세션 목록이 비어 있을 수 있습니다.");
  }
  // 패널은 터미널을 만들 수 없다. 이 워크트리의 전용 터미널을 CLI가 확보해 두어야
  // 다음 저장부터 사용자가 어느 터미널로 보낼지 고르지 않아도 된다.
  if (command !== "focus") await recordSaveTerminal(await ensureSaveTerminal());

  switch (command) {
    case "save": {
      const result = await saveChanges(decodePayload(argument));
      const applied = await writePanelSnapshot();
      report([
        `저장 완료 (${result.mode})`,
        ...result.warnings.map((warning) => `경고: ${warning}`),
      ]);
      return applied;
    }
    case "dispatch": {
      const request = decodePayload(argument);
      const record = await dispatchWorkItem(request);
      await recordDispatch(record, request.panelView);
      const applied = await writePanelSnapshot();
      report([
        record.error
          ? `일부 대상에 전달하지 못했습니다: ${record.error}`
          : `${record.targets.length}개 세션에 작업을 보냈습니다.`,
        ...record.targets.map((target) =>
          `  → ${target.projectName || target.label}${target.branch ? ` · ${target.branch}` : ""} · ${target.opened === "new-session" ? "새 세션" : "기존 세션"}`),
      ]);
      if (record.error && !record.targets.length) process.exitCode = 1;
      return applied;
    }
    case "source": {
      const result = await configureSource(decodePayload(argument));
      const applied = await writePanelSnapshot();
      report([`데이터 원천 설정 완료 (${result.dataSource.config.mode} · ${result.dataSource.status})`]);
      return applied;
    }
    case "refresh": {
      // 보낸 세션들의 결과도 이때 관측한다. 진행 중·성공·실패는 화면에서 읽은 사실이다.
      const [source, orcaTargets, outcomes] = await Promise.allSettled([
        refreshSource(), refreshTargets(), refreshDispatchOutcomes(),
      ]);
      if (source.status === "rejected") throw source.reason;
      const applied = await writePanelSnapshot();
      report([
        `다시 읽었습니다 (${source.value.dataSource.config.mode} · ${source.value.dataSource.status})`,
        targetsLine(orcaTargets),
        outcomes.status === "fulfilled"
          ? `실행 결과 확인 · 세션 ${outcomes.value.scanned}개`
          : "경고: 실행 결과를 확인하지 못했습니다.",
      ]);
      return applied;
    }
    case "focus": {
      // 실행 현황에서 "세션 열기"를 누르면 이 명령이 온다. 패널은 Orca UI를 조작할
      // 수 없으므로 탭을 앞으로 가져오는 것도 CLI를 거친다.
      if (!argument) throw new Error("focus needs a terminal handle");
      await runOrca(["terminal", "switch", "--terminal", argument]);
      report(["세션 탭을 앞으로 가져왔습니다."]);
      return true;
    }
    default:
      throw new Error(`unknown command: ${command ?? "(none)"}\nusage: graph-store.mjs <save|dispatch|source|refresh|focus> [payload]`);
  }
}

main()
  .then((applied) => console.log(applied === false
    ? "패널을 아직 빌드하지 않아 스냅샷은 싣지 못했습니다. 빌드한 뒤 패널을 열면 반영됩니다."
    : "패널을 다시 열면 반영됩니다."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
