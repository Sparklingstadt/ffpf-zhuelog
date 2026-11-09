import { Search, X } from "lucide-react";
import Link from "next/link";

import {
  ENTRY_SEARCH_MAX_LENGTH,
  isEntrySearchEmpty,
  type EntrySearch,
} from "@/domain/learning/entry-search";
import { Button } from "@/presentation/components/ui/button";
import { Input } from "@/presentation/components/ui/input";
import { Label } from "@/presentation/components/ui/label";

// Searches the notes shown on the home page. A plain GET form, so the search
// is in the URL and works without JavaScript. viewedOwnerId keeps an admin on
// the member they are viewing.
export function EntrySearchForm({
  search,
  viewedOwnerId,
  clearHref,
}: {
  search: EntrySearch;
  viewedOwnerId?: string;
  clearHref: string;
}) {
  return (
    <form
      role="search"
      aria-label="学習ノートを検索"
      action="/"
      className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_9rem_1fr_auto] sm:items-end"
    >
      {viewedOwnerId ? (
        <input type="hidden" name="user" value={viewedOwnerId} />
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="entry-search-q">語句</Label>
        <Input
          id="entry-search-q"
          name="q"
          type="search"
          defaultValue={search.query}
          maxLength={ENTRY_SEARCH_MAX_LENGTH}
          placeholder="中国語・日本語・ピンイン"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="entry-search-kind">種類</Label>
        <select
          id="entry-search-kind"
          name="kind"
          defaultValue={search.kind ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
        >
          <option value="">すべて</option>
          <option value="correction">添削</option>
          <option value="translation">翻訳</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="entry-search-hint">ヒント</Label>
        <Input
          id="entry-search-hint"
          name="hint"
          type="search"
          defaultValue={search.hint}
          maxLength={ENTRY_SEARCH_MAX_LENGTH}
          placeholder="例：了の位置"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit">
          <Search /> 検索
        </Button>
        {isEntrySearchEmpty(search) ? null : (
          <Button asChild variant="ghost">
            <Link href={clearHref}>
              <X /> クリア
            </Link>
          </Button>
        )}
      </div>
    </form>
  );
}
