import { z } from "zod";

export const batteryReportSchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      percent: z.number().int().min(0).max(100),
      state: z.enum([
        "charging",
        "discharging",
        "charged",
        "not-charging",
        "unknown",
      ]),
      powerSource: z.enum(["ac", "battery", "unknown"]),
      remainingMinutes: z
        .number()
        .int()
        .min(0)
        .max(7 * 24 * 60)
        .nullable(),
      checkedAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      available: z.literal(false),
      reason: z.enum(["unsupported", "no-battery", "read-failed"]),
      checkedAt: z.iso.datetime(),
    })
    .strict(),
]);

export type BatteryReport = z.infer<typeof batteryReportSchema>;

export function formatBatteryReply(value: unknown) {
  const report = batteryReportSchema.parse(value);
  const checkedAt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(report.checkedAt));
  const lines = ["Macのバッテリー"];
  if (report.available) {
    const states = {
      charging: "充電中",
      discharging: "バッテリー使用中",
      charged: "充電完了",
      "not-charging": "充電停止中",
      unknown: "不明",
    };
    const sources = {
      ac: "電源アダプター",
      battery: "バッテリー",
      unknown: "不明",
    };
    lines.push(
      `残量：${report.percent}%`,
      `状態：${states[report.state]}`,
      `電源：${sources[report.powerSource]}`,
    );
    if (
      report.remainingMinutes !== null &&
      ["charging", "discharging"].includes(report.state)
    ) {
      const label =
        report.state === "charging" ? "満充電までの目安" : "残り時間の目安";
      lines.push(
        `${label}：${Math.floor(report.remainingMinutes / 60)}時間${report.remainingMinutes % 60}分`,
      );
    }
  } else {
    const reasons = {
      unsupported: "このワーカーはmacOSで動作していないため、取得できません。",
      "no-battery": "内蔵バッテリーが見つかりません。",
      "read-failed":
        "バッテリー情報を取得できませんでした。時間をおいて再度お試しください。",
    };
    lines.push(reasons[report.reason]);
  }
  lines.push(`取得時刻：${checkedAt}（日本時間）`);
  return lines.join("\n");
}
