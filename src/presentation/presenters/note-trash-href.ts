import { parseLogDate } from "@ffpf-zhuelog/core/domain/calendar/value-objects/log-date";

import { getLogDateHref } from "./log-date-presenter";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

// Where a note goes after it is moved to the trash: its day's list, with the
// notice. The date comes from the form, so anything invalid falls back to the
// date list rather than becoming a redirect target.
export function trashedRedirectPath(
  basePath: "/logs" | "/conversations",
  formData: FormData,
) {
  const date = parseLogDate(
    field(formData, "year"),
    field(formData, "month"),
    field(formData, "day"),
  );
  return date ? `${getLogDateHref(date, basePath)}?trashed=1` : basePath;
}
