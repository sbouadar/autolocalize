// Icônes simulées dans les tests : la police d'icônes ne peut pas être chargée par Jest
// (« Module … is missing from the asset registry »). Une icône ne rend rien de visible.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
  const Icon = () => null;
  Icon.font = {};
  return { __esModule: true, default: Icon };
});

// Notifications push : module natif absent sous Jest. Simulation neutre (aucune inscription).
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { HIGH: 6 },
}));
