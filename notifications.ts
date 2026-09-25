import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { post } from "./api";
import { getToken } from "./session";

export function configureNotifications() {
  if(Platform.OS==="web") return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

export async function registerForPush(){
  if(Platform.OS==="web"||!Device.isDevice)return null;
  const current=await Notifications.getPermissionsAsync();
  let final=current.status;
  if(final!=="granted") final=(await Notifications.requestPermissionsAsync()).status;
  if(final!=="granted")return null;
  const projectId=process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const token=(await Notifications.getExpoPushTokenAsync(projectId?{projectId}:undefined)).data;
  const auth=await getToken(); if(auth)await post("/push-tokens",{token,platform:Platform.OS},auth);
  if(Platform.OS==="android")await Notifications.setNotificationChannelAsync("default",{name:"default",importance:Notifications.AndroidImportance.DEFAULT});
  return token;
}
