"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  streamChat,
  type StreamChatResult,
} from "@/presentation/components/chat/chat-stream";

type AskRequest = Omit<Parameters<typeof streamChat>[0], "signal">;

// Runs one streamed answer at a time and stops it when the page goes away.
// `ask` resolves to null when the page went away meanwhile, so the caller
// leaves its state alone.
export function useAnswerStream() {
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const ask = useCallback(
    async (request: AskRequest): Promise<StreamChatResult | null> => {
      const controller = new AbortController();
      abort.current = controller;
      const result = await streamChat({
        ...request,
        signal: controller.signal,
        onText: (text) => {
          if (mounted.current) request.onText(text);
        },
      });
      if (abort.current === controller) abort.current = null;
      return mounted.current ? result : null;
    },
    [],
  );

  // Stops the running answer; its `ask` resolves with the stopped result.
  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);

  const isMounted = useCallback(() => mounted.current, []);

  return { ask, stop, isMounted };
}
