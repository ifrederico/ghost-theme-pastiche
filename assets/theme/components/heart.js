/* ghost-like-button.js — v1.1.0 (single-SVG version) */
(() => {
  /* ---------- helpers ---------- */
  const API_DEFAULT = "/ghost-like-button";
  const VERSION     = "heart-1.1.0";

  const pageURL = () => location.origin + location.pathname + location.search;
  const join    = (base, path) => `${String(base || "").replace(/\/+$/, "")}${path}`;

  const buildURL = (apiBase, endpoint, url) => {
    const u = new URL(join(apiBase, endpoint), location.origin);
    u.searchParams.set("url", url);
    return u.toString();
  };

  const toggleClass = (el, cls) => {
    el.classList.remove(cls);
    /* force reflow to restart CSS animations */ void el.offsetWidth;
    el.classList.add(cls);
  };

  const formatLikes = n => Number(n || 0).toLocaleString("en");

  async function getMemberToken() {
    try {
      const r = await fetch("/members/api/session", { credentials: "same-origin" });
      if (r.status === 204) return null;                              /* not logged in  */
      if (r.status === 200) {                                         /* Ghost v6 token */
        const token = (await r.text()).trim();
        return token.split(".").length === 3 ? token : null;          /* basic JWT test */
      }
    } catch (err) {
      console.error("Error fetching member token:", err);
    }
    return null;
  }

  const getLikes = async (api, url, token) => {
    const r = await fetch(buildURL(api, "/get-likes", url), {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }).catch(() => null);
    if (!r || !r.ok) throw new Error("offline");
    const txt = await r.text().catch(() => "0");
    return { count: Number(txt || 0), has: r.headers.get("x-has-liked") === "1" };
  };

  const updateLikes = async (api, url, token) => {
    const r = await fetch(buildURL(api, "/update-likes", url), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(`1,${VERSION}`)
    }).catch(() => null);
    if (!r) throw new Error("offline");
    if (r.status === 401) throw new Error("auth");                    /* not signed in  */
    if (!r.ok) throw new Error("offline");
    const txt = await r.text().catch(() => "0");
    return { count: Number(txt || 0), has: r.headers.get("x-has-liked") === "1" };
  };

  /* ---------- web component ---------- */
  class LikeButton extends HTMLElement {
    connectedCallback() {
      if (this._connected) return;

      this.classList.add("loading");

      /* minimal DOM, now with ONE inline SVG */
      this.innerHTML = `
        <div class="style-root">
          <button type="button" aria-label="like post" class="heart-button">
            <div class="heart-wrapper">
              <svg class="heart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" aria-hidden="true">
                <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"></path>
              </svg>
            </div>
            <div class="like-count visually-hidden" aria-live="polite" aria-label="like count">0</div>
          </button>
        </div>
      `;

      /* cache references */
      this._styleRoot   = this.querySelector(".style-root");
      this._countEl     = this.querySelector(".like-count");
      this._likeBtn     = this.querySelector("button");

      /* attributes / defaults */
      this.api     = (this.getAttribute("api") || API_DEFAULT).replace(/\/+$/, "");
      this.url     = this.getAttribute("url") || pageURL();
      this.token   = null;
      this._offline          = false;
      this._hasLiked         = false;
      this._cachedLikeCount  = 0;

      /* initial load */
      (async () => {
        this.token = await getMemberToken();

        try {
          const { count, has } = await getLikes(this.api, this.url, this.token);
          this.classList.remove("loading");
          this._countEl.textContent = formatLikes(count);
          this._countEl.classList.remove("visually-hidden");
          this._cachedLikeCount = count;
          this._hasLiked        = has;
          this._updateButtonState(has);
          if (has) this.classList.add("liked");
        } catch (err) {
          console.error("Error fetching likes:", err);
          this.classList.remove("loading");
          this._enterOffline();
        }
      })();

      /* click handler */
      this._likeBtn.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this._offline) return;

        if (!this.token) {
          (document.getElementById("like-portal-signin") || {}).click?.();
          location.hash = "#/portal/signin";
          return;
        }

        /* optimistic UI */
        this._hasLiked ? this.classList.remove("liked")
                       : this.classList.add("liked");
        if (!this._hasLiked) toggleClass(this, "like");

        try {
          const { count, has } = await updateLikes(this.api, this.url, this.token);
          this._cachedLikeCount       = count;
          this._hasLiked              = has;
          this._countEl.textContent   = formatLikes(count);
          this._updateButtonState(has);
          this.classList.toggle("liked", has);
        } catch (err) {
          if (err.message === "auth") {
            (document.getElementById("like-portal-signin") || {}).click?.();
            location.hash = "#/portal/signin";
          } else {
            console.error("Error updating likes:", err);
            this._enterOffline();
          }
        }
      });

      this._connected = true;
    }

    _enterOffline() {
      if (this._offline) return;
      this._offline = true;
      this.classList.add("offline");
      this.setAttribute("aria-hidden", "true");
      this.hidden = true;
      if (this._likeBtn) {
        this._likeBtn.setAttribute("aria-disabled", "true");
        this._likeBtn.disabled = true;
      }
    }

    _updateButtonState(has) {
      if (!this._likeBtn) return;
      if (has) {
        this._likeBtn.setAttribute("aria-label", "remove like");
        this._likeBtn.setAttribute("title",       "Click to remove your like");
      } else {
        this._likeBtn.setAttribute("aria-label", "like post");
        this._likeBtn.setAttribute("title",       "Click to like this post");
      }
    }
  }

  /* define once */
  if (!customElements.get("like-button"))
    customElements.define("like-button", LikeButton);

  /* hidden portal trigger for non-members (if not already present) */
  if (!document.getElementById("like-portal-signin")) {
    const a = Object.assign(document.createElement("a"), {
      id: "like-portal-signin",
      hidden: true,
      dataset: { portal: "signin" }
    });
    document.body.appendChild(a);
  }
})();
