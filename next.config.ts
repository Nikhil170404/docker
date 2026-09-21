import path from "node:path";
import type { NextConfig } from "next";

// pagedjs (fidelity-mode PDF/print pagination) depends on `event-emitter`,
// an ~11-year-old CJS package built on `es5-ext`'s prototype-method
// ponyfills. Its CJS/ESM interop breaks under both Turbopack and webpack —
// `es5-ext/array/#/contains` resolves to something non-callable, throwing
// "contains.call is not a function" the instant pagedjs constructs its
// first Handlers instance (new Previewer().preview(...) always hits this).
// Both bundlers are pointed at a same-surface local reimplementation
// instead — see event-emitter-shim.js's own doc comment for the API this
// replicates. Turbopack's resolveAlias treats an absolute filesystem path
// as a server-relative import path (it doesn't accept one) — project-root-
// relative "./..." is the form its own docs use.
const eventEmitterShim = "./src/lib/fidelity/event-emitter-shim.js";
const eventEmitterPipeShim = "./src/lib/fidelity/event-emitter-pipe-shim.js";
const eventEmitterShimAbs = path.resolve(__dirname, "src/lib/fidelity/event-emitter-shim.js");
const eventEmitterPipeShimAbs = path.resolve(__dirname, "src/lib/fidelity/event-emitter-pipe-shim.js");

const nextConfig: NextConfig = {
  // The Docs/Sheets editors embed Univer, an imperative canvas library that
  // mounts its own React root into a container div and tears down shared
  // global state on dispose(). StrictMode's dev-only double-invoke
  // (mount -> cleanup -> mount) fights that: deferring the dispose call to
  // dodge the "synchronous unmount while rendering" warning corrupts the
  // second mount instead (verified empirically), so dispose has to stay
  // synchronous — which is exactly what triggers the warning. Disabling
  // StrictMode removes the double-invoke (and the warning) entirely; it
  // doesn't change production behavior, which never double-invokes anyway.
  reactStrictMode: false,
  turbopack: {
    resolveAlias: {
      "event-emitter": eventEmitterShim,
      "event-emitter/pipe.js": eventEmitterPipeShim,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "event-emitter$": eventEmitterShimAbs,
      "event-emitter/pipe.js$": eventEmitterPipeShimAbs,
    };
    return config;
  },
};

export default nextConfig;
