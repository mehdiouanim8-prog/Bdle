import * as Location from "expo-location";
import { post } from "./api";
import { getToken } from "./session";

export async function syncLocation() {
  const permission = await Location.getForegroundPermissionsAsync();
  const granted = permission.status === "granted" ? permission : await Location.requestForegroundPermissionsAsync();
  if (granted.status !== "granted") return { granted: false };
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const token = await getToken();
  if (token) await post("/location", { latitude: position.coords.latitude, longitude: position.coords.longitude }, token);
  return { granted: true, latitude: position.coords.latitude, longitude: position.coords.longitude };
}
