// post-actions.js
(function () {
  if (window.ghActionsInit) return;
  window.ghActionsInit = true;

  let shareMenuEl = null;
  let shareMenuOpenFor = null;
  let menuController = null;
  let abortController = null;

  // Utility: Debounce function for performance
  function debounce(func, wait) {
    var timeout;
    return function executedFunction() {
      var context = this;
      var args = arguments;
      var later = function() {
        timeout = null;
        func.apply(context, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Enhanced Menu Controller with Modern Patterns
  function createDisposable() {
    var cleanupFunctions = [];
    var api = {
      addEventListener: function(element, event, handler, options) {
        element.addEventListener(event, handler, options);
        return api.add(function() {
          element.removeEventListener(event, handler, options);
        });
      },
      setTimeout: function(callback, delay) {
        var id = setTimeout(callback, delay);
        return api.add(function() {
          clearTimeout(id);
        });
      },
      requestAnimationFrame: function(callback) {
        var id = requestAnimationFrame(callback);
        return api.add(function() {
          cancelAnimationFrame(id);
        });
      },
      add: function(cleanup) {
        if (cleanupFunctions.indexOf(cleanup) === -1) {
          cleanupFunctions.push(cleanup);
        }
        return function() {
          var index = cleanupFunctions.indexOf(cleanup);
          if (index !== -1) {
            cleanupFunctions.splice(index, 1);
            cleanup();
          }
        };
      },
      dispose: function() {
        for (var i = 0; i < cleanupFunctions.length; i++) {
          try {
            cleanupFunctions[i]();
          } catch (e) {
            console.error('Cleanup error:', e);
          }
        }
        cleanupFunctions.length = 0;
      }
    };
    return api;
  }

  // Lazy-loaded positioning utilities (created only when needed)
  var PositioningUtils = null;
  
  function getPositioningUtils() {
    if (PositioningUtils) return PositioningUtils;
    
    PositioningUtils = {
      pxNum: function(v, fallback){ var n=parseFloat(v); return isNaN(n)?fallback:n; },
      
      getVars: function(el){ 
        var cs=getComputedStyle(el); 
        return { 
          gap: this.pxNum(cs.getPropertyValue('--anchor-gap'),8), 
          offset: this.pxNum(cs.getPropertyValue('--anchor-offset'),0)
        }; 
      },
      
      parsePlacement: function(str, dir){
        str = (str||'').toLowerCase().trim() || 'bottom-start';
        var parts = str.split('-'), base = parts[0], align = parts[1] || 'center';
        if(base==='top'||base==='bottom'){
          if(align==='start') align = dir==='rtl' ? 'end' : 'start';
          if(align==='end')   align = dir==='rtl' ? 'start' : 'end';
        }
        return {base:base, align:align};
      },
      
      flipOf: function(base){ 
        return base==='top'?'bottom':base==='bottom'?'top':base==='left'?'right':'left'; 
      },
      
      measure: function(el){
        var hidden = !el.classList.contains('is-open');
        if(hidden){ el.style.visibility='hidden'; el.classList.add('is-open'); }
        var r = el.getBoundingClientRect();
        if(hidden){ el.classList.remove('is-open'); el.style.visibility=''; }
        return {width: r.width || el.offsetWidth || 0, height: r.height || el.offsetHeight || 0};
      },
      
      compute: function(triggerRect, menuSize, placement, gap, offset, viewport){
        var w=menuSize.width, h=menuSize.height, vw=viewport.width, vh=viewport.height;
        var self = this;
        
        function coords(base, align){
          var top=0,left=0;
          if(base==='bottom'){
            top = triggerRect.bottom + gap;
            if(align==='start') left = triggerRect.left + offset;
            else if(align==='end') left = triggerRect.right - w + offset;
            else left = triggerRect.left + (triggerRect.width - w)/2 + offset;
          }else if(base==='top'){
            top = triggerRect.top - h - gap;
            if(align==='start') left = triggerRect.left + offset;
            else if(align==='end') left = triggerRect.right - w + offset;
            else left = triggerRect.left + (triggerRect.width - w)/2 + offset;
          }else if(base==='right'){
            left = triggerRect.right + gap;
            if(align==='start') top = triggerRect.top + offset;
            else if(align==='end') top = triggerRect.bottom - h + offset;
            else top = triggerRect.top + (triggerRect.height - h)/2 + offset;
          }else if(base==='left'){
            left = triggerRect.left - w - gap;
            if(align==='start') top = triggerRect.top + offset;
            else if(align==='end') top = triggerRect.bottom - h + offset;
            else top = triggerRect.top + (triggerRect.height - h)/2 + offset;
          }
          return {top:top,left:left};
        }
        
        function overflows(c){ return c.left<4 || c.top<4 || c.left+w>vw-4 || c.top+h>vh-4; }
        var base=placement.base, align=placement.align, c=coords(base,align);
        if(overflows(c)){
          var fb = self.flipOf(base), c2 = coords(fb, align);
          if(!overflows(c2)){ base=fb; c=c2; }
        }
        c.top  = Math.max(4, Math.min(vh - h - 4, c.top));
        c.left = Math.max(4, Math.min(vw - w - 4, c.left));
        return { top: Math.round(c.top), left: Math.round(c.left), used: base + '-' + align };
      }
    };
    
    return PositioningUtils;
  }

  // Centralized scroll lock manager (simplified and optimized)
  var ScrollLockManager = {
    locks: new Map(),
    isMobile: function() {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    },
    
    create: function(signal) {
      var lockId = Date.now() + Math.random(); // Unique ID
      
      if (this.locks.size === 0) {
        // First lock - capture current state
        this.originalState = {
          scrollY: window.scrollY || window.pageYOffset,
          overflow: document.body.style.overflow,
          position: document.body.style.position,
          top: document.body.style.top,
          width: document.body.style.width
        };
        
        // Apply scroll lock
        if (this.isMobile()) {
          document.body.style.position = 'fixed';
          document.body.style.top = '-' + this.originalState.scrollY + 'px';
          document.body.style.width = '100%';
        }
        document.body.style.overflow = 'hidden';
      }
      
      this.locks.set(lockId, true);
      
      var self = this;
      var releaseFunction = function() {
        self.release(lockId);
      };
      
      // Auto-release on signal abort
      if (signal) {
        signal.addEventListener('abort', releaseFunction, { once: true });
      }
      
      return releaseFunction;
    },
    
    release: function(lockId) {
      this.locks.delete(lockId);
      
      if (this.locks.size === 0 && this.originalState) {
        // Last lock - restore original state
        document.body.style.overflow = this.originalState.overflow;
        document.body.style.position = this.originalState.position;
        document.body.style.top = this.originalState.top;
        document.body.style.width = this.originalState.width;
        
        if (this.isMobile()) {
          window.scrollTo(0, this.originalState.scrollY);
        }
        
        this.originalState = null;
      }
    }
  };

  document.addEventListener('click', function (e) {
    // SHARE
    const shareBtn = e.target.closest('.gh-post-share, .gh-card-share');
    if (shareBtn) {
      e.preventDefault(); e.stopPropagation();
      const url = shareBtn.dataset.url || location.href;
      const title = shareBtn.dataset.title || document.title;

      if (isMobileDevice() && navigator.share) {
        navigator.share({ title, url }).catch((err) => {
          const cancelled = err && (err.name === 'AbortError' || err.message === 'AbortError');
          if (!cancelled) copyToClipboard(url);
        });
      } else {
        // Desktop: toggle popover
        if (shareMenuEl && shareMenuEl.classList.contains('is-open') && shareMenuOpenFor === shareBtn) {
          closeShareMenu();
        } else {
          openShareMenu(shareBtn, { url, title });
        }
      }
      return;
    }

    // COMMENTS
    const commentsBtn = e.target.closest('.gh-post-comments, .gh-card-comments');
    if (!commentsBtn) return;
    e.preventDefault(); e.stopPropagation();

    if (commentsBtn.classList.contains('gh-post-comments')) {
      const el = document.querySelector('#ghost-comments-root');
      if (el) { el.scrollIntoView({ behavior:'smooth', block:'start' }); el.setAttribute('tabindex','-1'); el.focus(); }
      else { location.hash = 'ghost-comments-root'; }
    } else if (commentsBtn.dataset.postUrl) {
      location.href = commentsBtn.dataset.postUrl + '#ghost-comments-root';
    }
  });

  // ---------- Desktop popover ----------

  function openShareMenu(anchorBtn, payload) {
    // Clean up existing controller
    if (menuController) {
      menuController.dispose();
      menuController = null;
    }
    if (abortController) {
      abortController.abort();
    }

    if (!shareMenuEl) {
      shareMenuEl = buildShareMenuEl();
      document.body.appendChild(shareMenuEl);
    }

    // Set support for native share
    const nativeItem = shareMenuEl.querySelector('[data-action="native-share"]');
    if (navigator.share) {
      nativeItem.disabled = false;
      nativeItem.setAttribute('aria-disabled', 'false');
    } else {
      nativeItem.disabled = true;
      nativeItem.setAttribute('aria-disabled', 'true');
    }

    // Wire actions with current payload
    const copyItem = shareMenuEl.querySelector('[data-action="copy-link"]');
    copyItem.onclick = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      copyToClipboard(payload.url);
      closeShareMenu();
    };
    nativeItem.onclick = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (navigator.share) {
        navigator.share({ title: payload.title, url: payload.url })
          .then(closeShareMenu)
          .catch((err) => {
            const cancelled = err && (err.name === 'AbortError' || err.message === 'AbortError');
            if (!cancelled) copyToClipboard(payload.url);
            closeShareMenu();
          });
      } else {
        copyToClipboard(payload.url);
        closeShareMenu();
      }
    };

    // Create new AbortController for this menu instance
    abortController = new AbortController();
    
    // Enhanced positioning
    enhancedPositionMenu(shareMenuEl, anchorBtn);

    // Enhanced menu controller
    menuController = new EnhancedMenuController(anchorBtn, shareMenuEl, abortController.signal);
    menuController.show();

    shareMenuOpenFor = anchorBtn;
  }

  function closeShareMenu() {
    if (menuController) {
      menuController.hide();
      menuController.dispose();
      menuController = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    shareMenuOpenFor = null;
  }

  // Enhanced Menu Controller Class
  function EnhancedMenuController(trigger, menu, signal) {
    this.trigger = trigger;
    this.menu = menu;
    this.signal = signal || new AbortController().signal;
    this.disposable = createDisposable();
    this.open = false;
    this.scrollLockRelease = null;
    this.lastFocused = null;
    
    this.init();
  }

  EnhancedMenuController.prototype.init = function() {
    var self = this;
    if (this.signal.aborted) return;

    // Store focus when elements are focused
    this.disposable.addEventListener(document, 'focusin', function(e) {
      if (!self.menu.contains(e.target) && !self.trigger.contains(e.target)) {
        self.lastFocused = e.target;
      }
    }, true);

    // Cleanup on signal abort
    if (this.signal) {
      this.signal.addEventListener('abort', function() {
        self.dispose();
      });
    }
  };

  EnhancedMenuController.prototype.show = function() {
    var self = this;
    if (this.open) return;
    
    this.open = true;
    this.lastFocused = document.activeElement;
    this.trigger.setAttribute('aria-expanded', 'true');
    
    // Enable scroll lock for mobile
    this.scrollLockRelease = ScrollLockManager.create(this.signal);
    
    this.menu.classList.add('is-open');
    this.menu.setAttribute('aria-hidden', 'false');
    
    // Focus first enabled item
    const firstItem = this.menu.querySelector('.gh-share-item:not([disabled])');
    if (firstItem) firstItem.focus();
    
    // Debounced repositioning for better performance
    var debouncedReposition = debounce(function() { self.reposition(); }, 16); // ~60fps
    
    // Enhanced event listeners with disposable pattern
    this.disposable.addEventListener(window, 'scroll', debouncedReposition, { passive: true });
    this.disposable.addEventListener(window, 'resize', debouncedReposition, { passive: true });
    this.disposable.addEventListener(document, 'pointerdown', this.onDocumentPointerDown.bind(this), true);
    this.disposable.addEventListener(document, 'keydown', this.onDocumentKeydown.bind(this), true);
  };

  EnhancedMenuController.prototype.hide = function() {
    if (!this.open) return;
    
    this.open = false;
    this.trigger.setAttribute('aria-expanded', 'false');
    
    this.menu.classList.remove('is-open');
    this.menu.setAttribute('aria-hidden', 'true');

    // Release scroll lock
    if (this.scrollLockRelease) {
      this.scrollLockRelease();
      this.scrollLockRelease = null;
    }

    // Enhanced focus restoration with better error handling
    if (this.menu.contains(document.activeElement)) {
      this.restoreFocus();
    }
    
    this.lastFocused = null;
  };

  EnhancedMenuController.prototype.reposition = function() {
    enhancedPositionMenu(this.menu, this.trigger);
  };

  EnhancedMenuController.prototype.restoreFocus = function() {
    var focusTargets = [
      this.lastFocused,
      this.trigger,
      document.body
    ];
    
    for (var i = 0; i < focusTargets.length; i++) {
      var target = focusTargets[i];
      if (target && target.isConnected && typeof target.focus === 'function') {
        try {
          target.focus({ preventScroll: true });
          // Verify focus was actually set
          if (document.activeElement === target) {
            return true; // Success
          }
        } catch (error) {
          console.warn('Focus restoration failed for target:', target, error);
          // Continue to next target
        }
      }
    }
    
    // Last resort: try to blur current element
    try {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    } catch (error) {
      console.warn('Focus blur failed:', error);
    }
    
    return false; // All attempts failed
  };

  EnhancedMenuController.prototype.onDocumentKeydown = function(e) {
    if (e.key === 'Escape' && this.open) {
      e.preventDefault();
      this.hide();
    }
  };

  EnhancedMenuController.prototype.onDocumentPointerDown = function(e) {
    if (!this.open) return;
    
    var target = e.target;
    var insideMenu = this.menu.contains(target);
    var insideTrigger = this.trigger.contains(target);
    
    if (!insideMenu && !insideTrigger) {
      this.hide();
    }
  };

  EnhancedMenuController.prototype.dispose = function() {
    this.hide();
    this.disposable.dispose();
    
    if (this.scrollLockRelease) {
      this.scrollLockRelease();
      this.scrollLockRelease = null;
    }
  };

  function buildShareMenuEl() {
    const wrap = document.createElement('div');
    wrap.className = 'gh-share-menu';
    wrap.setAttribute('role', 'menu');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.setAttribute('data-placement', 'bottom-start');
    wrap.style.setProperty('--anchor-gap', '8px');
    wrap.style.setProperty('--anchor-offset', '0');

    // New icons (stroke-width="1.5", 16x16 render size)
    const linkSvg = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>`;

    const planeSvg = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true">
        <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"></path>
        <path d="m21.854 2.147-10.94 10.939"></path>
      </svg>`;

    wrap.innerHTML = `
      <button type="button" class="gh-share-item" role="menuitem" data-action="copy-link">
        <span class="gh-share-item-icon">${linkSvg}</span>
        <span class="gh-share-item-text">Copy link</span>
      </button>
      <button type="button" class="gh-share-item" role="menuitem"
              data-action="native-share" aria-disabled="true" disabled>
        <span class="gh-share-item-icon">${planeSvg}</span>
        <span class="gh-share-item-text">Send as message</span>
      </button>
    `;
    return wrap;
  }

  function enhancedPositionMenu(menu, anchorBtn) {
    const utils = getPositioningUtils(); // Lazy load
    const r = anchorBtn.getBoundingClientRect();
    const size = utils.measure(menu);
    const dir = getComputedStyle(document.documentElement).direction || 'ltr';
    const plc = utils.parsePlacement(menu.getAttribute('data-placement'), dir);
    const vars = utils.getVars(menu);
    const c = utils.compute(r, size, plc, vars.gap, vars.offset, {
      width: window.innerWidth, 
      height: window.innerHeight
    });
    
    menu.style.position = 'fixed';
    menu.style.left = c.left + 'px';
    menu.style.top = c.top + 'px';
    menu.setAttribute('data-placement-used', c.used);
  }

  // ---------- device + utils ----------

  function isMobileDevice() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const isAndroid = /Android/i.test(ua);
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    const isIPadOS13Plus = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return isAndroid || isiOS || isIPadOS13Plus;
  }

  function copyToClipboard(text){
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(()=>toast('Link copied')).catch(()=>legacyCopy(text));
    } else {
      legacyCopy(text);
    }
  }

  function legacyCopy(text){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Link copied'); }
    catch { toast('Could not copy link','error'); }
    ta.remove();
  }

  function getToastContainer(){
    let el = document.querySelector('.gh-notifications');
    if (!el) {
      el = document.createElement('aside');
      el.className = 'gh-notifications';
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, type = 'success'){
    const wrap = getToastContainer();
    const article = document.createElement('article');
    const err = (type === 'error' || type === 'warn') ? ' gh-notification-error' : '';
    article.className = 'gh-notification gh-notification-passive' + err;
    article.setAttribute('role', 'status');
    article.setAttribute('aria-live', 'polite');

    const icon = (type === 'error' || type === 'warn')
      ? '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2a10 10 0 110 20 10 10 0 010-20zm1 13h-2v-2h2v2zm0-4h-2V7h2v4z" fill="currentColor"></path></svg>'
      : '<svg viewBox="0 0 14 15" width="16" height="16" aria-hidden="true"><path d="M7 .5a7 7 0 100 14 7 7 0 000-14zm4.043 4.783l-3.996 5.42a.582.582 0 01-.834.11L3.36 8.533a.583.583 0 01-.087-.823.583.583 0 01.81-.088l2.38 1.902 3.64-4.94a.583.583 0 01.968.045.583.583 0 01-.028.654z" fill="currentColor"></path></svg>';

    article.innerHTML = `
      <div class="gh-notification-content">
        <div class="gh-notification-header">
          <div class="gh-notification-icon">${icon}</div>
          <div><span class="gh-notification-title">${message}</span></div>
        </div>
      </div>
      <button class="gh-notification-close" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" width="8" height="8" aria-hidden="true">
          <path d="M12.707 12L23.854.854a.5.5 0 00-.707-.707L12 11.293.854.146a.5.5 0 00-.707.707L11.293 12 .146 23.146a.5.5 0 00.708.708L12 12.707l11.146 11.146a.5.5 0 10.708-.706L12.707 12z" stroke-width="2"></path>
        </svg>
        <span class="hidden">Close</span>
      </button>
    `;
    wrap.appendChild(article);
    article.querySelector('.gh-notification-close')?.addEventListener('click',()=>article.remove(),{once:true});
    setTimeout(()=>{ if(article.parentNode) article.remove(); },5600);
  }
})();