import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const isWeb = Platform.OS === "web";

export async function getStorageItem(key: string): Promise<string | null> {
  if (isWeb) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

export async function setStorageItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try { globalThis.localStorage?.setItem(key, value); } catch {}
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteStorageItem(key: string): Promise<void> {
  if (isWeb) {
    try { globalThis.localStorage?.removeItem(key); } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
