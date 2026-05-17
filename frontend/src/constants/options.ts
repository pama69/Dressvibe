// Selection option catalogs for the Magic Outfit Generator (Italian).
export type Option = { value: string; label: string; emoji?: string };

export const GENDERS: Option[] = [
  { value: "donna", label: "Donna", emoji: "👩" },
  { value: "uomo", label: "Uomo", emoji: "👨" },
  { value: "ragazza", label: "Ragazza", emoji: "🧒" },
  { value: "ragazzo", label: "Ragazzo", emoji: "👦" },
];

export const AGES: Option[] = [
  { value: "giovane", label: "Giovane" },
  { value: "adulto", label: "Adulto" },
  { value: "maturo", label: "Maturo" },
];

export const BODIES: Option[] = [
  { value: "slim", label: "Slim" },
  { value: "atletico", label: "Atletico" },
  { value: "curvy", label: "Curvy" },
];

export const ETHNICITIES: Option[] = [
  { value: "caucasica", label: "Caucasica" },
  { value: "africana", label: "Africana" },
  { value: "asiatica", label: "Asiatica" },
  { value: "latina", label: "Latina" },
  { value: "mediorientale", label: "Mediorientale" },
];

export const POSES: Option[] = [
  { value: "casual_standing", label: "Casual in piedi" },
  { value: "dynamic_walking", label: "Camminata dinamica" },
  { value: "sitting_elegant", label: "Seduta elegante" },
  { value: "street_style", label: "Street style" },
  { value: "mirror_selfie", label: "Mirror selfie" },
];

export const BACKGROUNDS: Option[] = [
  { value: "white_studio", label: "Studio bianco" },
  { value: "city_street", label: "Strada urbana" },
  { value: "beach", label: "Spiaggia" },
  { value: "inside_shop", label: "Dentro al negozio" },
  { value: "lifestyle_home", label: "Casa lifestyle" },
];

export const SHOES: Option[] = [
  { value: "alta_elegante", label: "Alta elegante" },
  { value: "comoda_fashion", label: "Comoda fashion" },
  { value: "scarpa_bassa", label: "Scarpa bassa" },
];

export const CATEGORIES: Option[] = [
  { value: "t-shirt", label: "T-shirt" },
  { value: "camicia", label: "Camicia" },
  { value: "pantaloni", label: "Pantaloni" },
  { value: "jeans", label: "Jeans" },
  { value: "vestito", label: "Vestito" },
  { value: "gonna", label: "Gonna" },
  { value: "giacca", label: "Giacca" },
  { value: "cappotto", label: "Cappotto" },
  { value: "maglione", label: "Maglione" },
  { value: "felpa", label: "Felpa" },
  { value: "scarpe", label: "Scarpe" },
  { value: "accessorio", label: "Accessorio" },
];

export const SEASONS: Option[] = [
  { value: "primavera", label: "Primavera" },
  { value: "estate", label: "Estate" },
  { value: "autunno", label: "Autunno" },
  { value: "inverno", label: "Inverno" },
];

export const VARIATIONS = [1, 2, 4, 6, 8];
