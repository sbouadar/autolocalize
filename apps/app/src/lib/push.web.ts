// Web : pas de notifications push (les alertes restent dans l'onglet « Alertes »).
export const easProjectId = (): string | null => null;
export const registerForPush = async (): Promise<string | null> => null;
export const unregisterPush = async (): Promise<void> => {};
export const onNotificationOpened = (_open: () => void): (() => void) => () => {};
