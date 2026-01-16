// Minimal DOM type declarations for Figma plugin SVG processing
// These types are only used for SVG sprite inlining via DOMParser
// DO NOT add DOM lib to tsconfig - would pollute global scope with browser APIs

declare global {
  class DOMParser {
    parseFromString(string: string, type: string): Document;
  }

  class TextDecoder {
    constructor(encoding?: string);
    decode(input: ArrayBuffer | Uint8Array): string;
  }

  interface Document {
    documentElement: Element;
    getElementById(id: string): Element | null;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): NodeListOf<Element>;
    createElementNS(namespaceURI: string, qualifiedName: string): Element;
  }

  interface Element {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): NodeListOf<Element>;
    cloneNode(deep: boolean): Node;
    firstChild: Node | null;
    appendChild(child: Node): Node;
    removeChild(child: Node): Node;
    replaceChild(newChild: Node, oldChild: Node): Node;
    parentNode: Node | null;
    outerHTML: string;
  }

  interface Node {
    firstChild: Node | null;
    appendChild(child: Node): Node;
    removeChild(child: Node): Node;
    replaceChild(newChild: Node, oldChild: Node): Node;
    parentNode: Node | null;
  }

  interface NodeListOf<T> {
    length: number;
    item(index: number): T | null;
    [index: number]: T;
    [Symbol.iterator](): IterableIterator<T>;
  }
}

export {};
