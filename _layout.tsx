import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { configureNotifications } from "../src/notifications";

export default function Layout(){
  useEffect(()=>{
    if(typeof Platform !== "undefined" && Platform.OS === "web") return;
    configureNotifications();
    const sub=Notifications.addNotificationResponseReceivedListener((response)=>{
      const data:any=response.notification.request.content.data||{};
      if(data.matchId) router.push({pathname:"/chat/[id]",params:{id:String(data.matchId)}});
      else if(data.type==="MATCH") router.replace("/main");
    });
    return ()=>sub.remove();
  },[]);
  return <><StatusBar style="light"/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:"#08080D"}}}/></>;
}
