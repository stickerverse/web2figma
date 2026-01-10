/**
 * SelectionOverlay - Interactive element picker for capture selection mode
 * Provides visual feedback as user hovers over page elements with Figma-style highlighting
 */
export class SelectionOverlay {
  private overlay: HTMLElement;
  private label: HTMLElement;
  private hoveredElement: HTMLElement | null = null;
  private isActive: boolean = false;
  private readonly onSelect: (element: HTMLElement) => void;
  private readonly onCancel: () => void;

  constructor(onSelect: (element: HTMLElement) => void, onCancel: () => void) {
    this.onSelect = onSelect;
    this.onCancel = onCancel;

    // Create overlay element with Figma blue styling
    this.overlay = document.createElement("div");
    this.overlay.style.position = "fixed";
    this.overlay.style.pointerEvents = "none";
    this.overlay.style.background = "rgba(24, 160, 251, 0.1)"; // Figma blue tint
    this.overlay.style.border = "2px solid #18A0FB";
    this.overlay.style.zIndex = "2147483646"; // Below status overlay (2147483647)
    this.overlay.style.transition = "all 0.1s ease";
    this.overlay.style.boxSizing = "border-box";
    this.overlay.style.borderRadius = "2px";
    this.overlay.style.display = "none";
    this.overlay.setAttribute("data-web-to-figma-overlay", "true");

    // Create label
    this.label = document.createElement("div");
    this.label.style.position = "absolute";
    this.label.style.top = "-24px";
    this.label.style.left = "0";
    this.label.style.background = "#18A0FB";
    this.label.style.color = "white";
    this.label.style.padding = "2px 6px";
    this.label.style.fontSize = "12px";
    this.label.style.fontFamily = "Inter, -apple-system, system-ui, sans-serif";
    this.label.style.fontWeight = "500";
    this.label.style.borderRadius = "2px 2px 0 0";
    this.label.style.whiteSpace = "nowrap";
    this.label.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.15)";
    this.label.style.maxWidth = "400px";
    this.label.style.overflow = "hidden";
    this.label.style.textOverflow = "ellipsis";
    this.overlay.appendChild(this.label);

    // Bind methods to preserve 'this' context
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
  }

  /**
   * Activate selection mode - attach listeners and show crosshair cursor
   */
  public start(): void {
    if (this.isActive) {
      console.warn('[SelectionOverlay] Already active');
      return;
    }

    this.isActive = true;

    // Append overlay to body
    document.body.appendChild(this.overlay);

    // Attach event listeners (capture phase for reliability)
    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("keydown", this.handleKeyDown, true);
    document.addEventListener("scroll", this.handleScroll, true);
    window.addEventListener("resize", this.handleScroll);

    // Add crosshair cursor style (scoped to body to avoid breaking UI)
    const style = document.createElement("style");
    style.id = "web-to-figma-cursor-style";
    style.textContent = `
      body, body * {
        cursor: crosshair !important;
      }
      [data-web-to-figma-overlay] {
        cursor: default !important;
      }
    `;
    document.head.appendChild(style);

    console.log('[SelectionOverlay] Selection mode activated - click element or press Enter to select, ESC to cancel');
  }

  /**
   * Deactivate selection mode - cleanup listeners and remove overlay
   */
  public stop(): void {
    if (!this.isActive) return;

    this.isActive = false;

    // Remove overlay from DOM
    if (this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }

    // Remove cursor style
    const style = document.getElementById("web-to-figma-cursor-style");
    if (style) style.remove();

    // Remove event listeners
    document.removeEventListener("mousemove", this.handleMouseMove, true);
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);
    document.removeEventListener("scroll", this.handleScroll, true);
    window.removeEventListener("resize", this.handleScroll);

    // Clear state
    this.hoveredElement = null;

    console.log('[SelectionOverlay] Selection mode deactivated');
  }

  /**
   * Handle mouse movement - track element under cursor and update overlay position
   */
  private handleMouseMove(event: MouseEvent): void {
    if (!this.isActive) return;

    // Get element at cursor position
    const target = document.elementFromPoint(
      event.clientX,
      event.clientY
    ) as HTMLElement;

    // Ignore if no target or if it's our own overlay
    if (!target || target === this.overlay || this.overlay.contains(target)) {
      this.overlay.style.display = "none";
      this.hoveredElement = null;
      return;
    }

    // Ignore selection on body or html to prevent full-page captures
    if (target === document.body || target === document.documentElement) {
      this.overlay.style.display = "none";
      this.hoveredElement = null;
      return;
    }

    this.hoveredElement = target;
    this.updateOverlay(target);
  }

  /**
   * Update overlay position and label to match the target element
   */
  private updateOverlay(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();

    // Skip elements with zero dimensions
    if (rect.width === 0 || rect.height === 0) {
      this.overlay.style.display = "none";
      return;
    }

    // Position overlay to match element (fixed positioning)
    this.overlay.style.display = "block";
    this.overlay.style.top = `${rect.top}px`;
    this.overlay.style.left = `${rect.left}px`;
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;

    // Update label content
    const tagName = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const className =
      element.className && typeof element.className === "string"
        ? `.${element.className.split(" ").filter(c => c).slice(0, 2).join(".")}`
        : "";
    const dimensions = `${Math.round(rect.width)}×${Math.round(rect.height)}`;

    this.label.textContent = `${tagName}${id}${className} (${dimensions}px)`;

    // Adjust label position if it would go off-screen at top
    if (rect.top < 30) {
      // Position label inside element at top instead of above
      this.label.style.top = "0px";
      this.label.style.borderRadius = "0 2px 2px 0";
    } else {
      // Standard position above element
      this.label.style.top = "-24px";
      this.label.style.borderRadius = "2px 2px 0 0";
    }

    // Adjust label position if it would go off-screen on right
    if (rect.left + 400 > window.innerWidth) {
      this.label.style.left = "auto";
      this.label.style.right = "0";
    } else {
      this.label.style.left = "0";
      this.label.style.right = "auto";
    }
  }

  /**
   * Handle scroll/resize - update overlay position if element is still hovered
   */
  private handleScroll(): void {
    if (this.hoveredElement) {
      this.updateOverlay(this.hoveredElement);
    }
  }

  /**
   * Handle click - select the hovered element
   */
  private handleClick(event: MouseEvent): void {
    if (!this.isActive) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (this.hoveredElement) {
      const selected = this.hoveredElement;
      console.log('[SelectionOverlay] Element selected (click):', {
        tag: selected.tagName,
        id: selected.id,
        classes: selected.className,
      });

      this.stop();
      this.onSelect(selected);
    }
  }

  /**
   * Handle keyboard events:
   * - Escape: Cancel selection
   * - Enter: Select current element
   * - Arrow keys: Navigate DOM tree
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.isActive) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      console.log('[SelectionOverlay] Selection cancelled (ESC)');
      this.stop();
      this.onCancel();
    } else if (event.key === "Enter" && this.hoveredElement) {
      event.preventDefault();
      event.stopPropagation();

      const selected = this.hoveredElement;
      console.log('[SelectionOverlay] Element selected (Enter):', {
        tag: selected.tagName,
        id: selected.id,
        classes: selected.className,
      });

      this.stop();
      this.onSelect(selected);
    } else if (this.hoveredElement) {
      // Keyboard navigation through DOM tree
      let newElement: HTMLElement | null = null;

      if (event.key === "ArrowUp" && this.hoveredElement.parentElement) {
        // Navigate to parent element
        newElement = this.hoveredElement.parentElement;
        event.preventDefault();
      } else if (event.key === "ArrowDown") {
        // Navigate to first child element
        const firstChild = this.hoveredElement.children[0] as HTMLElement;
        if (firstChild) {
          newElement = firstChild;
          event.preventDefault();
        }
      } else if (event.key === "ArrowLeft") {
        // Navigate to previous sibling
        const prevSibling = this.hoveredElement.previousElementSibling as HTMLElement;
        if (prevSibling) {
          newElement = prevSibling;
          event.preventDefault();
        }
      } else if (event.key === "ArrowRight") {
        // Navigate to next sibling
        const nextSibling = this.hoveredElement.nextElementSibling as HTMLElement;
        if (nextSibling) {
          newElement = nextSibling;
          event.preventDefault();
        }
      }

      // Update overlay if navigation occurred
      if (newElement && newElement !== document.body && newElement !== document.documentElement) {
        this.hoveredElement = newElement;
        this.updateOverlay(newElement);
      }
    }
  }
}
