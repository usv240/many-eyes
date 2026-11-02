/** Minimal event/element harness: no browser emulation dependency is needed for these handlers. */
export class TestNode {
  value = ""; textContent: string | null = ""; innerHTML = ""; hidden = false; disabled = false;
  dataset: Record<string, string> = {}; files: File[] = [];
  classList = { toggle() {}, add() {}, remove() {} };
  private handlers = new Map<string, ((event: unknown) => unknown)[]>();
  addEventListener(event: string, handler: (event: unknown) => unknown) {
    this.handlers.set(event, [...this.handlers.get(event) ?? [], handler]);
  }
  async fire(event: string, value: unknown = {}) { for (const handler of this.handlers.get(event) ?? []) await handler(value); }
  append(...items: unknown[]) { this.textContent += items.map(String).join(""); }
  scrollIntoView() {}
}
export function pageHarness() {
  const nodes = new Map<string, TestNode>();
  const node = (selector: string) => { let item = nodes.get(selector); if (!item) { item = new TestNode(); nodes.set(selector, item); } return item; };
  return { node, document: { querySelector: node, querySelectorAll: () => [], createElement: () => new TestNode() } };
}
