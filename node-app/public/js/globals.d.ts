// Types for the small helpers the plain browser scripts share through `window` (no modules, no bundler).
// Only read by `npm run check` (tsc); never sent to the browser.

interface Window {
  morph: {
    morphChildren(target: ParentNode & Node, source: ParentNode & Node): void;
    morphElement(target: Element, source: Element): void;
    parseFragment(html: string): DocumentFragment;
  };
}
