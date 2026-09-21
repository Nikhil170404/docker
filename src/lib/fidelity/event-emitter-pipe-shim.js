// Matches event-emitter/pipe.js's contract: forward every event emitted on
// e1 to also emit on e2, returning a handle whose close() stops forwarding.
// See event-emitter-shim.js for why the real package is replaced here.
import { methods } from "./event-emitter-shim.js";

const emit = methods.emit;

export default function pipe(e1, e2, name) {
  if (name === undefined) name = "emit";
  const pipes = e1.__eePipes__ || (e1.__eePipes__ = []);
  pipes.push(e2);

  if (!e1.__eePiped__) {
    e1.__eePiped__ = true;
    const original = e1[name];
    e1[name] = function (...args) {
      if (typeof original === "function") original.apply(this, args);
      else emit.apply(this, args);
      for (const target of e1.__eePipes__) emit.apply(target, args);
    };
  }

  return {
    close: function () {
      const idx = e1.__eePipes__.indexOf(e2);
      if (idx !== -1) e1.__eePipes__.splice(idx, 1);
    },
  };
}
