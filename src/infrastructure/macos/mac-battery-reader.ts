import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  batteryReportSchema,
  type BatteryReport,
} from "@/domain/line/battery-report";

const execute = promisify(execFile);

export function parseMacBattery(
  output: string,
  checkedAt = new Date().toISOString(),
): BatteryReport {
  const line = output
    .split("\n")
    .find((value) => /-InternalBattery-\d+\b/.test(value));
  if (!line) {
    return {
      available: false,
      reason: /Now drawing from '(AC|Battery) Power'/.test(output)
        ? "no-battery"
        : "read-failed",
      checkedAt,
    };
  }
  const percent = line.match(/\b(\d{1,3})%;/);
  if (!percent) return { available: false, reason: "read-failed", checkedAt };
  const rawState = line.split(";")[1]?.trim();
  const state =
    rawState === "charging" ||
    rawState === "discharging" ||
    rawState === "charged"
      ? rawState
      : rawState === "not charging" || rawState === "AC attached"
        ? "not-charging"
        : "unknown";
  const time = line.match(/\b(\d{1,3}):(\d{2}) remaining\b/);
  const minutes =
    time && Number(time[2]) < 60
      ? Number(time[1]) * 60 + Number(time[2])
      : null;
  const parsed = batteryReportSchema.safeParse({
    available: true,
    percent: Number(percent[1]),
    state,
    powerSource: output.includes("Now drawing from 'AC Power'")
      ? "ac"
      : output.includes("Now drawing from 'Battery Power'")
        ? "battery"
        : "unknown",
    remainingMinutes:
      minutes !== null && minutes <= 7 * 24 * 60 ? minutes : null,
    checkedAt,
  });
  return parsed.success
    ? parsed.data
    : { available: false, reason: "read-failed", checkedAt };
}

export async function readMacBattery(
  signal?: AbortSignal,
): Promise<BatteryReport> {
  signal?.throwIfAborted();
  if (process.platform !== "darwin") {
    return {
      available: false,
      reason: "unsupported",
      checkedAt: new Date().toISOString(),
    };
  }
  try {
    // Fixed executable and arguments only: no shell, user input, secrets or AI.
    const { stdout } = await execute("/usr/bin/pmset", ["-g", "batt"], {
      encoding: "utf8",
      shell: false,
      timeout: 5000,
      maxBuffer: 16 * 1024,
      signal,
      env: {
        NODE_ENV: "development",
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
    return parseMacBattery(stdout);
  } catch {
    signal?.throwIfAborted();
    return {
      available: false,
      reason: "read-failed",
      checkedAt: new Date().toISOString(),
    };
  }
}
