import {
  getScrollableElement,
  getScrollbarWidth,
  getScrollLeft,
  getScrollTop,
} from './../../../helpers/dom/element';
import {arrayEach} from './../../../helpers/array';
import {isKey} from './../../../helpers/unicode';
import {isMobileBrowser} from './../../../helpers/browser';
import EventManager from './../../../eventManager';
import Overlay from './overlay/_base.js';

/**
 * @class Overlays
 */
class Overlays {
  /**
   * @param {Walkontable} wotInstance
   */
  constructor(wotInstance) {
    this.wot = wotInstance;

    // legacy support
    this.instance = this.wot;
    this.eventManager = new EventManager(this.wot);

    this.wot.update('scrollbarWidth', getScrollbarWidth());
    this.wot.update('scrollbarHeight', getScrollbarWidth());

    this.scrollableElement = void 0;
    this.scrollResizerY = void 0;
    this.scrollResizerX = void 0;

    this.prepareOverlays();
    this.prepareScrollableElement();

    this.destroyed = false;
    this.keyPressed = false;
    this.spreaderLastSize = {
      width: null,
      height: null,
    };
    this.overlayScrollPositions = {
      master: {
        top: 0,
        left: 0,
      },
      top: {
        top: null,
        left: 0,
      },
      bottom: {
        top: null,
        left: 0
      },
      left: {
        top: 0,
        left: null
      }
    };

    this.pendingScrollCallbacks = {
      master: {
        top: 0,
        left: 0,
      },
      top: {
        left: 0,
      },
      bottom: {
        left: 0,
      },
      left: {
        top: 0,
      }
    };

    this.verticalScrolling = false;
    this.horizontalScrolling = false;
    this.delegatedScrollCallback = false;

    this.registeredListeners = [];

    this.registerListeners();
  }

  prepareScrollableElement() {
    this.scrollableElement = document.createElement('div');
    this.scrollableElement.className = 'scroll-overlay';

    this.scrollResizerY = document.createElement('div');
    this.scrollResizerY.className = 'scroll-y';

    this.scrollResizerX = document.createElement('div');
    this.scrollResizerX.className = 'scroll-x';

    this.scrollableElement.appendChild(this.scrollResizerY);
    this.scrollableElement.appendChild(this.scrollResizerX);

    this.wot.wtTable.wtRootElement.parentNode.appendChild(this.scrollableElement);

    this.eventManager.addEventListener(this.scrollableElement, 'scroll', (event) => this.onTableScroll(event));
  }
  /**
   * Prepare overlays based on user settings.
   *
   * @returns {Boolean} Returns `true` if changes applied to overlay needs scroll synchronization.
   */
  prepareOverlays() {
    let syncScroll = false;

    if (this.topOverlay) {
      syncScroll = this.topOverlay.updateStateOfRendering() || syncScroll;
    } else {
      this.topOverlay = Overlay.createOverlay(Overlay.CLONE_TOP, this.wot);
    }

    if (!Overlay.hasOverlay(Overlay.CLONE_BOTTOM)) {
      this.bottomOverlay = {
        needFullRender: false,
        updateStateOfRendering: () => false,
      };
    }
    if (!Overlay.hasOverlay(Overlay.CLONE_BOTTOM_LEFT_CORNER)) {
      this.bottomLeftCornerOverlay = {
        needFullRender: false,
        updateStateOfRendering: () => false,
      };
    }

    if (this.bottomOverlay) {
      syncScroll = this.bottomOverlay.updateStateOfRendering() || syncScroll;
    } else {
      this.bottomOverlay = Overlay.createOverlay(Overlay.CLONE_BOTTOM, this.wot);
    }

    if (this.leftOverlay) {
      syncScroll = this.leftOverlay.updateStateOfRendering() || syncScroll;
    } else {
      this.leftOverlay = Overlay.createOverlay(Overlay.CLONE_LEFT, this.wot);
    }

    if (this.topOverlay.needFullRender && this.leftOverlay.needFullRender) {
      if (this.topLeftCornerOverlay) {
        syncScroll = this.topLeftCornerOverlay.updateStateOfRendering() || syncScroll;
      } else {
        this.topLeftCornerOverlay = Overlay.createOverlay(Overlay.CLONE_TOP_LEFT_CORNER, this.wot);
      }
    }

    if (this.bottomOverlay.needFullRender && this.leftOverlay.needFullRender) {
      if (this.bottomLeftCornerOverlay) {
        syncScroll = this.bottomLeftCornerOverlay.updateStateOfRendering() || syncScroll;
      } else {
        this.bottomLeftCornerOverlay = Overlay.createOverlay(Overlay.CLONE_BOTTOM_LEFT_CORNER, this.wot);
      }
    }

    if (this.wot.getSetting('debug') && !this.debug) {
      this.debug = Overlay.createOverlay(Overlay.CLONE_DEBUG, this.wot);
    }

    return syncScroll;
  }

  /**
   * Refresh and redraw table
   */
  refreshAll() {
    if (!this.wot.drawn) {
      return;
    }
    if (!this.wot.wtTable.holder.parentNode) {
      // Walkontable was detached from DOM, but this handler was not removed
      this.destroy();

      return;
    }
    this.wot.draw(true);

    if (this.verticalScrolling) {
      this.leftOverlay.onScroll();
    }

    if (this.horizontalScrolling) {
      this.topOverlay.onScroll();
    }

    this.verticalScrolling = false;
    this.horizontalScrolling = false;
  }

  /**
   * Register all necessary event listeners.
   */
  registerListeners() {
    const topOverlayScrollable = this.topOverlay.mainTableScrollableElement;
    const leftOverlayScrollable = this.leftOverlay.mainTableScrollableElement;

    let listenersToRegister = [];
    listenersToRegister.push([document.documentElement, 'keydown', (event) => this.onKeyDown(event)]);
    listenersToRegister.push([document.documentElement, 'keyup', () => this.onKeyUp()]);
    listenersToRegister.push([document, 'visibilitychange', () => this.onKeyUp()]);

    this.eventManager.addEventListener(topOverlayScrollable, 'wheel', (event) => this.onTableScroll(event), {passive: true});
  }

  /**
   * Deregister all previously registered listeners.
   */
  deregisterListeners() {
    while (this.registeredListeners.length) {
      let listener = this.registeredListeners.pop();
      this.eventManager.removeEventListener(listener[0], listener[1], listener[2]);
    }
  }

  /**
   * Scroll listener
   *
   * @param {Event} event
   */
  onTableScroll(event) {
    // if mobile browser, do not update scroll positions, as the overlays are hidden during the scroll
    if (isMobileBrowser()) {
      return;
    }
    const masterHorizontal = this.leftOverlay.mainTableScrollableElement;
    const masterVertical = this.topOverlay.mainTableScrollableElement;
    const target = event.target;

    // For key press, sync only master -> overlay position because while pressing Walkontable.render is triggered
    // by hot.refreshBorder
    if (this.keyPressed) {
      if ((masterVertical !== window && target !== window && !event.target.contains(masterVertical)) ||
          (masterHorizontal !== window && target !== window && !event.target.contains(masterHorizontal))) {
        return;
      }
    }

    if (event.type === 'scroll') {
      // event.preventDefault();
      this.syncScrollPositions(event);

    } else {
      this.translateMouseWheelToScroll(event);
    }
  }

  /**
   * Key down listener
   */
  onKeyDown(event) {
    this.keyPressed = isKey(event.keyCode, 'ARROW_UP|ARROW_RIGHT|ARROW_DOWN|ARROW_LEFT');
  }

  /**
   * Key up listener
   */
  onKeyUp() {
    this.keyPressed = false;
  }

  /**
   * Translate wheel event into scroll event and sync scroll overlays position
   *
   * @private
   * @param {Event} event
   * @returns {Boolean}
   */
  translateMouseWheelToScroll(event) {
    let deltaX = (-event.wheelDeltaX || event.deltaX) / 40 * 19;
    let deltaY = (-event.wheelDeltaY || event.deltaY) / 40 * 19;

    // Fix for extremely slow header scrolling with a mousewheel on Firefox
    if (event.deltaMode === 1) {
      deltaX *= 15;
      deltaY *= 15;
    }

    this.scrollableElement.scrollLeft += deltaX;
    this.scrollableElement.scrollTop += deltaY;
  }

  /**
   * Synchronize scroll position between master table and overlay table.
   *
   * @private
   * @param {Event|Object} event
   */
  syncScrollPositions(event) {
    if (this.destroyed) {
      return;
    }

    const top = getScrollTop(event.target);
    const left = getScrollLeft(event.target);
    const holder = this.wot.wtTable.holder;

    if (holder.scrollTop !== top) {
      holder.scrollTop = top;
      this.wot.wtOverlays.leftOverlay.clone.wtTable.holder.scrollTop = top;
      this.topOverlay.mainTableScrollableElement.scrollTop = top;
      this.verticalScrolling = true;
    }

    if (holder.scrollLeft !== left) {
      holder.scrollLeft = left;
      this.wot.wtOverlays.topOverlay.clone.wtTable.holder.scrollLeft = left;
      this.wot.wtTable.holder.scrollLeft = left;
      this.horizontalScrolling = true;
    }

    this.refreshAll();
  }

  /**
   * Synchronize overlay scrollbars with the master scrollbar
   */
  syncScrollWithMaster() {
    const master = this.topOverlay.mainTableScrollableElement;
    const {scrollLeft, scrollTop} = master;

    if (this.topOverlay.needFullRender) {
      this.topOverlay.clone.wtTable.holder.scrollLeft = scrollLeft;
    }
    if (this.bottomOverlay.needFullRender) {
      this.bottomOverlay.clone.wtTable.holder.scrollLeft = scrollLeft;
    }
    if (this.leftOverlay.needFullRender) {
      this.leftOverlay.clone.wtTable.holder.scrollTop = scrollTop;
    }
  }

  /**
   * Update the main scrollable elements for all the overlays.
   */
  updateMainScrollableElements() {
    this.deregisterListeners();

    this.leftOverlay.updateMainScrollableElement();
    this.topOverlay.updateMainScrollableElement();

    if (this.bottomOverlay.needFullRender) {
      this.bottomOverlay.updateMainScrollableElement();
    }

    this.registerListeners();
  }

  /**
   *
   */
  destroy() {
    this.eventManager.destroy();
    this.topOverlay.destroy();

    if (this.bottomOverlay.clone) {
      this.bottomOverlay.destroy();
    }
    this.leftOverlay.destroy();

    if (this.topLeftCornerOverlay) {
      this.topLeftCornerOverlay.destroy();
    }

    if (this.bottomLeftCornerOverlay && this.bottomLeftCornerOverlay.clone) {
      this.bottomLeftCornerOverlay.destroy();
    }

    if (this.debug) {
      this.debug.destroy();
    }
    this.destroyed = true;
  }

  /**
   * @param {Boolean} [fastDraw=false]
   */
  refresh(fastDraw = false) {
    if (this.topOverlay.areElementSizesAdjusted && this.leftOverlay.areElementSizesAdjusted) {
      let container = this.wot.wtTable.wtRootElement.parentNode || this.wot.wtTable.wtRootElement;
      let width = container.clientWidth;
      let height = container.clientHeight;

      if (width !== this.spreaderLastSize.width || height !== this.spreaderLastSize.height) {
        this.spreaderLastSize.width = width;
        this.spreaderLastSize.height = height;
        this.adjustElementsSize();
      }
    }

    if (this.bottomOverlay.clone) {
      this.bottomOverlay.refresh(fastDraw);
    }

    this.leftOverlay.refresh(fastDraw);
    this.topOverlay.refresh(fastDraw);

    if (this.topLeftCornerOverlay) {
      this.topLeftCornerOverlay.refresh(fastDraw);
    }

    if (this.bottomLeftCornerOverlay && this.bottomLeftCornerOverlay.clone) {
      this.bottomLeftCornerOverlay.refresh(fastDraw);
    }

    if (this.debug) {
      this.debug.refresh(fastDraw);
    }
  }

  /**
   * Adjust overlays elements size and master table size
   *
   * @param {Boolean} [force=false]
   */
  adjustElementsSize(force = false) {
    let totalColumns = this.wot.getSetting('totalColumns');
    let totalRows = this.wot.getSetting('totalRows');
    let headerRowSize = this.wot.wtViewport.getRowHeaderWidth();
    let headerColumnSize = this.wot.wtViewport.getColumnHeaderHeight();
    let hiderStyle = this.wot.wtTable.hider.style;

    hiderStyle.width = `${headerRowSize + this.leftOverlay.sumCellSizes(0, totalColumns)}px`;
    hiderStyle.height = `${headerColumnSize + this.topOverlay.sumCellSizes(0, totalRows) + 1}px`;

    this.topOverlay.adjustElementsSize(force);
    this.leftOverlay.adjustElementsSize(force);

    if (this.bottomOverlay.clone) {
      this.bottomOverlay.adjustElementsSize(force);
    }

    this.scrollResizerY.style.height = hiderStyle.height;
    this.scrollResizerX.style.width = hiderStyle.width;
    this.wot.wtOverlays.leftOverlay.adjustRootElementSize();
    this.wot.wtOverlays.topOverlay.adjustRootElementSize();
  }

  /**
   *
   */
  applyToDOM() {
    if (!this.topOverlay.areElementSizesAdjusted || !this.leftOverlay.areElementSizesAdjusted) {
      this.adjustElementsSize();
    }
    this.topOverlay.applyToDOM();

    if (this.bottomOverlay.clone) {
      this.bottomOverlay.applyToDOM();
    }

    this.leftOverlay.applyToDOM();
  }

  /**
   * Get the parent overlay of the provided element.
   *
   * @param {HTMLElement} element
   * @returns {Object|null}
   */
  getParentOverlay(element) {
    if (!element) {
      return null;
    }

    let overlays = [
      this.topOverlay,
      this.leftOverlay,
      this.bottomOverlay,
      this.topLeftCornerOverlay,
      this.bottomLeftCornerOverlay
    ];
    let result = null;

    arrayEach(overlays, (elem, i) => {
      if (!elem) {
        return;
      }

      if (elem.clone && elem.clone.wtTable.TABLE.contains(element)) {
        result = elem.clone;
      }
    });

    return result;
  }
}

export default Overlays;
