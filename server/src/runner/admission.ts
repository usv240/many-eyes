/** Fail closed at capacity: never evict message IDs and accidentally accept a replay. */
export class Admission {
  private readonly messages = new Set<string>();
  private readonly users = new Set<string>();
  constructor(private readonly maxMessages = 100_000, private readonly maxUsers = 10_000) {}
  has(id: string) { return this.messages.has(id); }
  message(id: string) {
    if (!id || id.length > 256 || this.messages.has(id) || this.messages.size >= this.maxMessages) return false;
    this.messages.add(id); return true;
  }
  user(id: string) {
    if (!id || id.length > 128) return false;
    if (this.users.has(id)) return true;
    if (this.users.size >= this.maxUsers) return false;
    this.users.add(id); return true;
  }
}
