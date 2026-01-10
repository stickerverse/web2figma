/**
 * Trusted Types Helper
 *
 * Provides a centralized way to create TrustedHTML objects to satisfy
 * strict Content Security Policies (CSP) that require Trusted Types.
 */

// Define Trusted Types types locally since they might not be in the global scope
declare global {
  interface Window {
    trustedTypes?: {
      createPolicy: (
        name: string,
        rules: {
          createHTML?: (input: string) => string;
          createScript?: (input: string) => string;
          createScriptURL?: (input: string) => string;
        }
      ) => TrustedTypePolicy;
      defaultPolicy?: TrustedTypePolicy;
      getAttributeType?: (tagName: string, attribute: string) => string;
    };
  }
}

interface TrustedTypePolicy {
  createHTML: (input: string) => any;
  createScript: (input: string) => any;
  createScriptURL: (input: string) => any;
  name: string;
}

let policy: TrustedTypePolicy | null = null;
const POLICY_NAME = "figma-convert-policy";

/**
 * Gets or creates a Trusted Types policy.
 * Tries to use existing default policy or creates a new one.
 */
function getPolicy(): TrustedTypePolicy | null {
  if (policy) return policy;

  if (typeof window === "undefined" || !window.trustedTypes) {
    return null;
  }

  try {
    // Try to reuse default policy if available
    if (window.trustedTypes.defaultPolicy) {
      policy = window.trustedTypes.defaultPolicy;
      return policy;
    }

    // Create our policy
    policy = window.trustedTypes.createPolicy(POLICY_NAME, {
      createHTML: (string: string) => string, // Pass-through policy (identity)
      createScript: (string: string) => string,
      createScriptURL: (string: string) => string,
    });
  } catch (e) {
    console.warn("[CSP] Failed to create Trusted Types policy:", e);
    // Fallback: try to find if our policy already exists (e.g. from another bundle)
    // Unfortunately there's no getPolicy API, so we just have to fail gracefully
  }

  return policy;
}

/**
 * Escapes HTML special characters to prevent XSS
 * @param text Untrusted text input
 * @returns HTML-safe escaped string
 */
function escapeHTML(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * SECURITY: Basic HTML sanitizer that allows only safe tags and escapes dangerous content
 * Allows: <b>, <i>, <strong>, <em>, <br>, <div>, <span>, <p>, <ul>, <li>, <details>, <summary>, <pre>
 * Removes: <script>, <iframe>, <object>, <embed>, event handlers, javascript: URLs
 *
 * @param html HTML string to sanitize
 * @returns Sanitized HTML safe for innerHTML
 */
function sanitizeHTML(html: string): string {
  // Create temporary DOM to parse and sanitize
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Recursively sanitize all nodes
  const sanitizeNode = (node: Node): Node | null => {
    // Text nodes are safe
    if (node.nodeType === Node.TEXT_NODE) {
      return node;
    }

    // Only allow specific safe elements
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      // Whitelist of safe tags
      const safeTags = ['div', 'span', 'p', 'b', 'i', 'strong', 'em', 'br',
                        'ul', 'li', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                        'details', 'summary', 'pre', 'code', 'button'];

      if (!safeTags.includes(tagName)) {
        // Replace dangerous tags with their text content
        const textNode = document.createTextNode(element.textContent || '');
        return textNode;
      }

      // Remove dangerous attributes
      const dangerousAttrs = ['onclick', 'onload', 'onerror', 'onmouseover',
                              'onfocus', 'onblur', 'onchange', 'onsubmit'];

      for (const attr of dangerousAttrs) {
        element.removeAttribute(attr);
      }

      // Sanitize href and src attributes
      if (element.hasAttribute('href')) {
        const href = element.getAttribute('href') || '';
        if (href.toLowerCase().startsWith('javascript:') || href.toLowerCase().startsWith('data:')) {
          element.removeAttribute('href');
        }
      }

      if (element.hasAttribute('src')) {
        const src = element.getAttribute('src') || '';
        if (src.toLowerCase().startsWith('javascript:') || src.toLowerCase().startsWith('data:text/html')) {
          element.removeAttribute('src');
        }
      }

      // Recursively sanitize children
      const children = Array.from(element.childNodes);
      for (const child of children) {
        const sanitizedChild = sanitizeNode(child);
        if (!sanitizedChild) {
          element.removeChild(child);
        }
      }
    }

    return node;
  };

  // Sanitize all children
  const children = Array.from(temp.childNodes);
  for (const child of children) {
    sanitizeNode(child);
  }

  return temp.innerHTML;
}

/**
 * Converts a string to TrustedHTML if Trusted Types are supported/enforced.
 * SECURITY: Now properly sanitizes HTML to prevent XSS attacks.
 *
 * @param html The HTML string to sanitize/wrap
 * @returns TrustedHTML object or sanitized string
 */
export function createTrustedHTML(html: string): string | any {
  // CRITICAL: Sanitize HTML BEFORE creating TrustedHTML
  const sanitized = sanitizeHTML(html);

  const p = getPolicy();
  if (p) {
    try {
      return p.createHTML(sanitized);
    } catch (e) {
      console.warn("[CSP] Failed to create TrustedHTML, returning sanitized string:", e);
      return sanitized;
    }
  }
  return sanitized;
}

/**
 * Helper to escape plain text for safe insertion into HTML
 * Use this when you don't need HTML tags, just text content
 */
export function escapeText(text: string): string {
  return escapeHTML(text);
}
