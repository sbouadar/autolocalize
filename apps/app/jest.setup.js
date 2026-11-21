// Icônes simulées dans les tests : la police d'icônes ne peut pas être chargée par Jest
// (« Module … is missing from the asset registry »). Une icône ne rend rien de visible.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
  const Icon = () => null;
  Icon.font = {};
  return { __esModule: true, default: Icon };
});
