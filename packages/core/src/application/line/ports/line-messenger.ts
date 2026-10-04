export interface LineMessenger {
  pushText(
    userId: string,
    text: string,
    retryKey: string,
  ): Promise<"accepted" | "retry" | "rejected">;
  push(
    userId: string,
    csv: string,
    retryKey: string,
  ): Promise<"accepted" | "retry" | "rejected">;
}
