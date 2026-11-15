// The chat, quick questions and their notes need OpenAI on the Go side. When
// Go runs without it, those pages say the chat is unavailable instead of
// failing.
export class ChatUnavailableError extends Error {
  constructor() {
    super("The Go API has no chat");
    this.name = "ChatUnavailableError";
  }
}
