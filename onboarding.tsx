import React,{useEffect}from"react";import{Platform,View,ActivityIndicator}from"react-native";import{router}from"expo-router";import{api}from"../src/api";import{getToken,clearToken}from"../src/session";import{registerForPush}from"../src/notifications";import{syncLocation}from"../src/location";
export default function Onboarding(){
  useEffect(()=>{
    (async()=>{
      const t=await getToken();
      if(!t){router.replace("/");return;}
      try{
        const m=await api("/me",{},t);
        const web=Platform.OS==="web";
        if(m.emailStatus!=="VERIFIED")return router.replace("/verify-email");
        if(!web&&m.phoneStatus!=="VERIFIED")return router.replace("/verify-phone");
        if(!m.profile)return router.replace("/profile");
        if(!m.profile.photos?.length)return router.replace("/photos");
        if(m.kyc?.status!=="VERIFIED")return router.replace("/verification");
        if(m.photoVerification?.status!=="VERIFIED")return router.replace("/photo-verification");
        if(m.profile?.reviewStatus!=="APPROVED")return router.replace("/review");
        if(m.membership?.status!=="ACTIVE")return router.replace("/subscribe");
        await syncLocation().catch(()=>null);
        if(!web)await registerForPush().catch(()=>null);
        return router.replace("/main");
      }catch{
        await clearToken();
        router.replace("/");
      }
    })();
  },[]);
  return <View style={{flex:1,backgroundColor:"#08080D",alignItems:"center",justifyContent:"center"}}><ActivityIndicator color="#B88A3B"/></View>;
}
