import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useKpis } from "../dashboard";

const mockApi = jest.fn();
jest.mock("../api", () => ({ api: (path: string) => mockApi(path) }));

const toOf = (path: string) => new URLSearchParams(path.split("?")[1]).get("to");
const fromOf = (path: string) => new URLSearchParams(path.split("?")[1]).get("from");

describe("useKpis", () => {
  afterEach(() => jest.useRealTimers());

  it("recalcule les bornes de la période à chaque rafraîchissement", async () => {
    jest.useFakeTimers({ doNotFake: ["setTimeout", "setInterval", "setImmediate", "queueMicrotask", "nextTick"] });
    jest.setSystemTime(new Date(2026, 10, 17, 23, 50));
    mockApi.mockResolvedValue({});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    const { result } = await renderHook(() => useKpis("today"), { wrapper });
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    const first = mockApi.mock.calls[0]![0] as string;
    expect(toOf(first)).toBe(new Date(2026, 10, 17, 23, 50).toISOString());
    expect(fromOf(first)).toBe(new Date(2026, 10, 17).toISOString());

    // Vingt minutes plus tard, après minuit : « Aujourd'hui » désigne le jour suivant.
    jest.setSystemTime(new Date(2026, 10, 18, 0, 10));
    await act(async () => {
      await result.current.refetch();
    });
    const second = mockApi.mock.calls[1]![0] as string;
    expect(toOf(second)).toBe(new Date(2026, 10, 18, 0, 10).toISOString());
    expect(fromOf(second)).toBe(new Date(2026, 10, 18).toISOString());
    client.clear();
  });
});
