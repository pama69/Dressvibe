// Bridge store: lets the model-picker screen pass the chosen preset back to
// /generate without inflating URL params with a base64 thumbnail.
type Selected = {
  id: string;
  name: string;
  thumb_base64: string;
} | null;

let _value: Selected = null;
const _listeners = new Set<() => void>();

export const presetSelectionStore = {
  set(v: Selected) {
    _value = v;
    _listeners.forEach((fn) => {
      try { fn(); } catch {}
    });
  },
  get(): Selected {
    return _value;
  },
  clear() {
    this.set(null);
  },
  subscribe(fn: () => void) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  },
};
