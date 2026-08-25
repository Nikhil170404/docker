/**
 * DocKaro embed SDK.
 *
 *   <script src="https://dockaro.com/dockaro.js"></script>
 *   <script>
 *     const editor = DocKaro.mount('#editor', { mode: 'richtext' });
 *     await editor.ready;
 *     const html = await editor.getHTML();
 *   </script>
 *
 * One editor, two jobs. `mode: 'richtext'` is a continuous-flow editor that
 * hands back an HTML fragment — a CMS field, a comment box, a description.
 * `mode: 'document'` is a paginated Word surface that hands back a .docx —
 * a contract, an invoice, an offer letter. Same engine underneath, so the
 * same content can come out either way.
 *
 * No licence key. No banner in front of your users. Plain ES5-compatible
 * script with no build step and no dependencies.
 */
(function (global) {
  "use strict";

  var NAMESPACE = "dockaro-embed";
  var DEFAULT_BASE_URL = "https://dockaro.com";
  var MODES = ["richtext", "document"];

  function randomId() {
    return "req_" + Math.random().toString(36).slice(2, 11);
  }

  function resolveElement(target) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) throw new Error("DocKaro.mount: no element matched " + target);
    return el;
  }

  function originOf(url) {
    var a = document.createElement("a");
    a.href = url;
    return a.protocol + "//" + a.host;
  }

  /**
   * @param {string|Element} target  Where to mount.
   * @param {object} [options]
   * @param {'richtext'|'document'} [options.mode]
   * @param {string} [options.documentId]  Reuse to reopen the same document.
   * @param {string} [options.baseUrl]     Point at your own deployment.
   * @param {string} [options.height]
   * @param {(e:{wordCount:number,pageCount:number}) => void} [options.onChange]
   */
  function mount(target, options) {
    var opts = options || {};
    var el = resolveElement(target);
    var mode = MODES.indexOf(opts.mode) === -1 ? "richtext" : opts.mode;
    var baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    var documentId = opts.documentId || "new";
    var frameOrigin = originOf(baseUrl);

    var iframe = document.createElement("iframe");
    iframe.src =
      baseUrl + "/e/" + encodeURIComponent(documentId) + "?mode=" + mode;
    iframe.style.width = "100%";
    iframe.style.height = opts.height || (mode === "document" ? "800px" : "360px");
    iframe.style.border = "1px solid #e1dfdd";
    iframe.style.borderRadius = "6px";
    iframe.style.display = "block";
    iframe.setAttribute("title", "DocKaro editor");
    // The editor needs same-origin storage for autosave and scripts to run;
    // it does not need top-level navigation or popups.
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-downloads",
    );
    el.appendChild(iframe);

    var pending = {};
    var readyResolve;
    var readyReject;
    var ready = new Promise(function (resolve, reject) {
      readyResolve = resolve;
      readyReject = reject;
    });
    var isReady = false;

    function onMessage(event) {
      if (event.source !== iframe.contentWindow) return;
      var data = event.data;
      if (!data || data.namespace !== NAMESPACE) return;

      if (data.direction === "event") {
        if (data.event.type === "ready") {
          isReady = true;
          readyResolve(api);
        } else if (data.event.type === "change" && opts.onChange) {
          opts.onChange({
            wordCount: data.event.wordCount,
            pageCount: data.event.pageCount,
          });
        }
        return;
      }

      if (data.direction === "response") {
        var entry = pending[data.id];
        if (!entry) return;
        delete pending[data.id];
        if (data.error) entry.reject(new Error(data.error));
        else entry.resolve(data.result);
      }
    }

    window.addEventListener("message", onMessage);

    function request(payload) {
      if (!iframe.contentWindow) {
        return Promise.reject(new Error("DocKaro: editor has been destroyed."));
      }
      var id = randomId();
      var promise = new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
      });
      iframe.contentWindow.postMessage(
        { namespace: NAMESPACE, direction: "request", id: id, request: payload },
        frameOrigin,
      );
      return promise;
    }

    /** Queue calls made before the editor announced itself. */
    function whenReady(payload) {
      return isReady
        ? request(payload)
        : ready.then(function () {
            return request(payload);
          });
    }

    var api = {
      mode: mode,
      iframe: iframe,
      ready: ready,

      /** The document as an HTML fragment. */
      getHTML: function () {
        return whenReady({ type: "getHTML" });
      },

      /** The document as a .docx Blob, ready to upload or download. */
      getDocx: function () {
        return whenReady({ type: "getDocx" }).then(function (result) {
          return new Blob([result.buffer], { type: result.mimeType });
        });
      },

      /**
       * Replace the editor's content with a .docx the user picked.
       * Accepts a File or Blob; resolves once the editor has reloaded.
       */
      loadDocx: function (file) {
        return file.arrayBuffer().then(function (buffer) {
          return whenReady({
            type: "loadDocx",
            buffer: buffer,
            fileName: file.name || "document.docx",
          });
        });
      },

      /** The raw document model, if you want to store it and reload it later. */
      getSnapshot: function () {
        return whenReady({ type: "getSnapshot" });
      },

      setName: function (name) {
        return whenReady({ type: "setName", name: name });
      },

      focus: function () {
        return whenReady({ type: "focus" });
      },

      destroy: function () {
        window.removeEventListener("message", onMessage);
        Object.keys(pending).forEach(function (id) {
          pending[id].reject(new Error("DocKaro: editor destroyed."));
          delete pending[id];
        });
        if (!isReady) readyReject(new Error("DocKaro: editor destroyed before ready."));
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      },
    };

    return api;
  }

  global.DocKaro = { mount: mount, version: 1 };
})(typeof window !== "undefined" ? window : this);
