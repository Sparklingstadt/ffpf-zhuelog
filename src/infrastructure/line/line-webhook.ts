import type { LineEvent } from "@/domain/line/line-message";
import {
  fieldValues,
  stringField,
  objectField,
  isJsonObject,
  type JsonObject,
} from "@/infrastructure/line/json-fields";

// Go: line.ParseWebhook (line/webhook.go:34-57). The message events of a
// delivery, in order; null when Go's json.Unmarshal would have refused the
// body (Go answers 400 then).
//
// As with Go's decoder: unknown fields are ignored, field names match
// case-insensitively, a null or missing field is the zero value ("" or an
// empty struct), and a field of the wrong JSON type anywhere is an error. The
// bytes are decoded as UTF-8 with invalid bytes replaced, and a byte order
// mark is kept, so JSON.parse refuses it as Go does.
//
// Not reproduced: Go decodes a repeated "events" key into the elements the
// earlier one left, where here the last array replaces them; and JSON.parse
// keeps only the last of keys spelled exactly alike. LINE sends neither, and
// only a body whose signature verified is read.
export function parseLineWebhook(body: Uint8Array): LineEvent[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(body),
    );
  } catch {
    return null;
  }
  if (payload === null) return [];
  if (!isJsonObject(payload)) return null;

  // A null "events" empties the slice in Go; an array replaces it.
  let events: readonly unknown[] = [];
  for (const value of fieldValues([payload], "events")) {
    if (value === null) events = [];
    else if (Array.isArray(value)) events = value;
    else return null;
  }

  const read: (LineEvent | "skip")[] = [];
  for (const element of events) {
    // A null element is a zero event, whose type "" is dropped.
    if (element === null) continue;
    if (!isJsonObject(element)) return null;
    const event = readEvent(element);
    if (event === null) return null;
    read.push(event);
  }
  return read.filter((event) => event !== "skip");
}

// One element of events: the event, "skip" when it is not a message event,
// or null when Go would fail to decode it. Every field is checked whatever
// the event's type, as Go decodes the whole body first.
function readEvent(element: JsonObject): LineEvent | "skip" | null {
  const raw = [element];
  const type = stringField(raw, "type");
  const webhookEventId = stringField(raw, "webhookEventId");
  const replyToken = stringField(raw, "replyToken");
  const source = objectField(raw, "source");
  const message = objectField(raw, "message");
  if (
    type === null ||
    webhookEventId === null ||
    replyToken === null ||
    source === null ||
    message === null
  )
    return null;

  const sourceType = stringField(source, "type");
  const userId = stringField(source, "userId");
  const messageType = stringField(message, "type");
  const text = stringField(message, "text");
  if (
    sourceType === null ||
    userId === null ||
    messageType === null ||
    text === null
  )
    return null;

  if (type !== "message") return "skip";
  const isText = messageType === "text";
  return {
    webhookEventId,
    replyToken,
    userId,
    text: isText ? text : "",
    isText,
    fromUser: sourceType === "user",
  };
}
