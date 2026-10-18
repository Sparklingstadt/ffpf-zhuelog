export const chatDisabledResponse = () =>
  Response.json(
    { error: "会話機能は停止しています。" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
