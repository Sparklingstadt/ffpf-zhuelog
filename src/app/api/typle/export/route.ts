import { getCurrentAdminUser } from "@/composition/identity-container";
import { learningUseCases } from "@/composition/learning-container";
import { createTypleExport } from "@/domain/typle/typle-word-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getCurrentAdminUser())) {
    return Response.json(
      { error: "管理者としてログインしてください。" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const { entries } = await learningUseCases.listRecentEntries.execute(1000);
    const payload = createTypleExport(entries);
    if (payload.lists[0].words.length === 0) {
      return Response.json(
        { error: "Typle用に抽出できる単語がありません。" },
        { status: 422, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition":
          'attachment; filename="ffpf-zhuelog-typle-words.json"',
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch {
    console.error("TYPLE_EXPORT_UNAVAILABLE");
    return Response.json(
      { error: "Typle用の単語リストを作成できませんでした。" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
