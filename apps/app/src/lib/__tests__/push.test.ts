import * as Notifications from "expo-notifications";

const mockApi = jest.fn();
let mockProjectId: string | undefined = "projet-eas";

jest.mock("../api", () => ({ api: (...args: unknown[]) => mockApi(...args) }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockProjectId ? { eas: { projectId: mockProjectId } } : {} };
    },
    easConfig: null,
  },
}));

const notifications = Notifications as jest.Mocked<typeof Notifications>;

beforeEach(() => {
  mockApi.mockReset().mockResolvedValue(undefined);
  mockProjectId = "projet-eas";
  jest.clearAllMocks();
});

describe("notifications push", () => {
  it("inscrit l'appareil une fois l'autorisation donnée, puis le désinscrit à la déconnexion", async () => {
    const { registerForPush, unregisterPush } = jest.requireActual<typeof import("../push")>("../push");
    notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
    expect(await registerForPush()).toBe("ExponentPushToken[test]");
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "projet-eas" });
    expect(mockApi).toHaveBeenCalledWith("/me/push-tokens", { method: "POST", body: { token: "ExponentPushToken[test]", platform: "IOS" } });
    await unregisterPush();
    expect(mockApi).toHaveBeenLastCalledWith("/me/push-tokens/remove", { method: "POST", body: { token: "ExponentPushToken[test]" } });
  });

  it("ne fait rien sans autorisation, ni sans projet EAS", async () => {
    const { registerForPush } = jest.requireActual<typeof import("../push")>("../push");
    notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    expect(await registerForPush()).toBeNull();
    mockProjectId = undefined;
    expect(await registerForPush()).toBeNull();
    expect(mockApi).not.toHaveBeenCalled();
  });
});
