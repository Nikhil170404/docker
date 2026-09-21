// Drop-in replacement for the `event-emitter` npm package, which pagedjs
// depends on. The real package (event-emitter@0.3.5, an ~11-year-old CJS
// library built on `es5-ext`'s prototype-method ponyfills) fails under
// Turbopack's module interop — `es5-ext/array/#/contains` resolves to
// something other than a callable function, throwing "contains.call is not
// a function" the moment pagedjs constructs its first Handlers instance.
// Reimplemented here matching event-emitter's exact documented on/once/off/
// emit semantics (single listener stored bare, multiple as an array; a
// `once` listener tracks its original via `__eeOnceListener__` so `off`
// can still remove it by the caller's original reference) — this is the
// full surface pagedjs's source (handlers.js, chunker.js, layout.js,
// page.js, modules/handler.js, polyfill/previewer.js) actually calls.
// Written as ESM (pagedjs imports it as `import EventEmitter from
// "event-emitter"`) rather than mirroring the real package's own CJS shape.
const hasOwn = Object.prototype.hasOwnProperty;

function on(type, listener) {
  if (typeof listener !== "function") throw new TypeError(listener + " is not a function");
  if (!hasOwn.call(this, "__ee__")) {
    Object.defineProperty(this, "__ee__", { value: Object.create(null), configurable: true, enumerable: false, writable: true });
  }
  const data = this.__ee__;
  if (!data[type]) data[type] = listener;
  else if (Array.isArray(data[type])) data[type].push(listener);
  else data[type] = [data[type], listener];
  return this;
}

function off(type, listener) {
  if (!hasOwn.call(this, "__ee__")) return this;
  const data = this.__ee__;
  const listeners = data[type];
  if (!listeners) return this;
  if (Array.isArray(listeners)) {
    for (let i = 0; i < listeners.length; i++) {
      const candidate = listeners[i];
      if (candidate === listener || candidate.__eeOnceListener__ === listener) {
        if (listeners.length === 2) data[type] = listeners[i ? 0 : 1];
        else listeners.splice(i, 1);
        break;
      }
    }
  } else if (listeners === listener || listeners.__eeOnceListener__ === listener) {
    delete data[type];
  }
  return this;
}

function once(type, listener) {
  // `wrapped` below needs the object `once()` was called on, not its own `this`.
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;
  const wrapped = function (...args) {
    off.call(self, type, wrapped);
    listener.apply(this, args);
  };
  wrapped.__eeOnceListener__ = listener;
  on.call(this, type, wrapped);
  return this;
}

function emit(type, ...args) {
  if (!hasOwn.call(this, "__ee__")) return;
  const listeners = this.__ee__[type];
  if (!listeners) return;
  if (Array.isArray(listeners)) {
    for (const listener of listeners.slice()) listener.apply(this, args);
  } else {
    listeners.apply(this, args);
  }
}

export const methods = { on, once, off, emit };

export default function EventEmitter(o) {
  const target = o == null ? Object.create(null) : Object(o);
  for (const key of ["on", "once", "off", "emit"]) {
    Object.defineProperty(target, key, { value: methods[key], configurable: true, enumerable: false, writable: true });
  }
  return target;
}
EventEmitter.methods = methods;
