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
