// Tiny in-memory store for cross-screen generation params (kept simple).
type GenParams = {
  garment_ids: string[];
  model_gender: string;
  model_age: string;
  model_body: string;
  model_ethnicity: string;
  pose: string;
  background: string;
  shoes: string;
  num_variations: number;
  provider?: string;
  custom_background_id?: string;
  look_styles?: string[];
  add_price_tags?: boolean;
  /** Optional face preset id (e.g. "preset_sofia"). When set the AI uses
   *  the preset's face description and locks the demographic chips in the UI. */
  model_preset_id?: string | null;
  /** Display-only name for the selected preset, shown in the generator chip. */
  model_preset_name?: string | null;
  /** Display-only thumb (base64 JPEG, no prefix) for the selected preset. */
  model_preset_thumb?: string | null;
};

let _params: GenParams | null = null;

export const genStore = {
  set(p: GenParams) {
    _params = p;
  },
  get(): GenParams | null {
    return _params;
  },
  clear() {
    _params = null;
  },
};
