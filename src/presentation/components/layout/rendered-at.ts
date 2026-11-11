// When the server renders a page, for parts that must notice a new render
// (the review count). Only server components call it, once per request, so
// it is not the impure render the purity rule guards against.
export function renderedAt(): number {
  return Date.now();
}
