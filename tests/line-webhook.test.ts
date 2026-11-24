import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLineWebhook } from "../src/infrastructure/line/line-webhook";

const parse = (s: string) => parseLineWebhook(new TextEncoder().encode(s));

const textEvent = {
  type: "message",
  webhookEventId: "E1",
  replyToken: "r1",
  source: { type: "user", userId: "U1" },
  message: { type: "text", text: "你好" },
};

test("deliveries are read into their message events", () => {
  for (const empty of ['{"events":[]}', "{}", "null", '{"events":null}'])
    assert.deepEqual(parse(empty), [], empty);

  assert.deepEqual(parse(JSON.stringify({ events: [textEvent] })), [
    {
      webhookEventId: "E1",
      replyToken: "r1",
      userId: "U1",
      text: "你好",
      isText: true,
      fromUser: true,
    },
  ]);

  for (const type of ["group", "room"]) {
    const event = { ...textEvent, source: { type, userId: "U1" } };
    const [read] = parse(JSON.stringify({ events: [event] })) ?? [];
    assert.equal(read?.fromUser, false, type);
    assert.equal(read?.userId, "U1", type);
  }

  const sticker = {
    ...textEvent,
    message: { type: "sticker", text: "ignored", packageId: "1" },
  };
  const [stickerRead] = parse(JSON.stringify({ events: [sticker] })) ?? [];
  assert.equal(stickerRead?.isText, false);
  assert.equal(stickerRead?.text, "");
});

test("only message events are kept and unknown fields are ignored", () => {
  const body = JSON.stringify({
    destination: "Uxxx",
    events: [
      {
        type: "follow",
        replyToken: "f",
        source: { type: "user", userId: "U1" },
      },
      null,
      {
        ...textEvent,
        mode: "active",
        timestamp: 1,
        deliveryContext: { isRedelivery: false },
      },
      { type: "unfollow", source: { type: "user", userId: "U1" } },
    ],
  });
  const events = parse(body);
  assert.equal(events?.length, 1);
  assert.equal(events?.[0]?.webhookEventId, "E1");
});

test("null and missing fields read as empty", () => {
  const body = JSON.stringify({
    events: [
      {
        type: "message",
        webhookEventId: null,
        source: null,
        message: { type: "text" },
      },
    ],
  });
  assert.deepEqual(parse(body), [
    {
      webhookEventId: "",
      replyToken: "",
      userId: "",
      text: "",
      isText: true,
      fromUser: false,
    },
  ]);
});

test("keys match field names whatever their case", () => {
  const body =
    '{"EVENTS":[{"Type":"message","webhookeventid":"E2","source":{"TYPE":"user","userID":"U2"},"message":{"type":"text","Text":"hi"}}]}';
  assert.deepEqual(parse(body), [
    {
      webhookEventId: "E2",
      replyToken: "",
      userId: "U2",
      text: "hi",
      isText: true,
      fromUser: true,
    },
  ]);
  // U+017F (long s) folds to S and U+212A (Kelvin sign) to K.
  const folded =
    '{"event\u017f":[{"type":"message","webhoo\u212aEventId":"E3"}]}';
  assert.equal(parse(folded)?.[0]?.webhookEventId, "E3");
  // The dotted and dotless i do not fold to I.
  const notFolded =
    '{"events":[{"type":"message","source":{"user\u0130d":"U","user\u0131d":"V"}}]}';
  assert.equal(parse(notFolded)?.[0]?.userId, "");
  // A null leaves the field as an earlier key set it.
  assert.equal(parse('{"events":[{"type":"message","Type":null}]}')?.length, 1);
  // Two keys for one object fill it together.
  const [merged] =
    parse(
      '{"events":[{"type":"message","source":{"type":"user"},"Source":{"userId":"U4"}}]}',
    ) ?? [];
  assert.equal(merged?.fromUser, true);
  assert.equal(merged?.userId, "U4");
  // A null events empties what an earlier key gave.
  assert.deepEqual(parse('{"events":[{"type":"message"}],"Events":null}'), []);
  // A wrong type is an error even when a later key has the right one.
  assert.equal(parse('{"events":[{"type":5,"Type":"message"}]}'), null);
  assert.equal(parse('{"events":[],"Events":5}'), null);
});

test("bodies with a field of the wrong type are null", () => {
  for (const body of [
    "not json",
    "[]",
    '"x"',
    "5",
    '{"events":{}}',
    '{"events":[1]}',
    '{"events":["x"]}',
    '{"events":[{"type":5}]}',
    '{"events":[{"type":"message","source":"x"}]}',
    '{"events":[{"type":"message","message":{"text":7}}]}',
    '{"events":[{"type":"follow","source":{"userId":1}}]}',
    // A byte order mark is not skipped.
    '\ufeff{"events":[]}',
  ])
    assert.equal(parse(body), null, body);
});
