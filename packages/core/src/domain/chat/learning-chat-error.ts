// A chat failure whose message is safe to show on screen. Any other error is
// shown with a generic message.
export class LearningChatError extends Error {}

// Another answer is still being generated, so this one was not started.
export class LearningChatBusyError extends LearningChatError {}
