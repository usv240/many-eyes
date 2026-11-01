import type { ViewModel } from "./view.js";

/** Cache node lookups and prior values; unchanged snapshots produce no DOM writes. */
export function createRenderer(root: ParentNode) {
  const nodes = new Map<string, HTMLElement>();
  const prior = new Map<string, unknown>();
  const node = (name: string) => {
    let found = nodes.get(name);
    if (!found) {
      found = root.querySelector<HTMLElement>('[data-node="' + name + '"]') ?? undefined;
      if (!found) throw new Error("Missing overlay node: " + name);
      nodes.set(name, found);
    }
    return found;
  };
  const change = (key: string, value: unknown, apply: () => void) => {
    if (prior.has(key) && prior.get(key) === value) return;
    apply(); prior.set(key, value);
  };
  return (model: ViewModel) => {
    for (const [name, value] of Object.entries(model.text)) change(name + ":text", value, () => { node(name).textContent = value; });
    for (const [name, attributes] of Object.entries(model.attributes)) for (const [key, value] of Object.entries(attributes))
      change(name + ":attr:" + key, value, () => { if (value === null) node(name).removeAttribute(key); else node(name).setAttribute(key, value); });
    for (const [name, styles] of Object.entries(model.styles)) for (const [key, value] of Object.entries(styles))
      change(name + ":style:" + key, value, () => { node(name).style.setProperty(key, value); });
    // SVG elements do not implement HTMLElement.hidden; use the attribute for both.
    for (const [name, value] of Object.entries(model.hidden)) change(name + ":hidden", value, () => {
      if (value) node(name).setAttribute("hidden", ""); else node(name).removeAttribute("hidden");
    });
  };
}
