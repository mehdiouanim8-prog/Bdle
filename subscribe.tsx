import React,{useEffect,useState}from"react";import{ScrollView,Text,View,Platform}from"react-native";import{router}from"expo-router";import{getToken}from"../src/session";import{api}from"../src/api";import{Button,styles,C}from"../src/ui";import Purchases,{LOG_LEVEL}from"react-native-purchases";
const ENT=process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID||"bundle_membership";const PRODUCT=process.env.EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID||"bundle_monthly_999";
export default function Subscribe(){
  const web=Platform.OS==="web";
  const[ready,setReady]=useState(false);const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[restoring,setRestoring]=useState(false);
  useEffect(()=>{(async()=>{
    try{
      const t=await getToken();const me=await api("/me",{},t||undefined);
      if(web){setReady(false);return;}
      const key=Platform.OS==="ios"?process.env.EXPO_PUBLIC_REVENUECAT_IOS_PUBLIC_KEY:process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_PUBLIC_KEY;
      if(!key)throw new Error("RevenueCat public key is not configured.");
      Purchases.setLogLevel(LOG_LEVEL.WARN);await Purchases.configure({apiKey:key,appUserID:me.id});setReady(true);
      const info=await Purchases.getCustomerInfo();if(info.entitlements.active[ENT])router.replace("/main");
    }catch(e:any){setError(e.message)}
  })()},[web]);
  async function finish(){let tries=0;while(tries<5){const t=await getToken();const m=await api("/me",{},t||undefined);if(m.membership?.status==="ACTIVE"){router.replace("/main");return}await new Promise(r=>setTimeout(r,1200));tries++}setError("Your purchase was completed, but Bundle is still synchronizing membership. Please refresh shortly.")}
  async function buy(){setBusy(true);setError("");try{if(!ready)throw new Error("Subscription billing is not available on the website yet. Mobile membership uses Apple App Store / Google Play and remains unchanged.");const offerings=await Purchases.getOfferings();const pkg=offerings.current?.monthly||offerings.current?.availablePackages.find((x:any)=>x.product.identifier===PRODUCT);if(!pkg)throw new Error(`Monthly product ${PRODUCT} is not configured in RevenueCat.`);const result=await Purchases.purchasePackage(pkg);if(result.customerInfo.entitlements.active[ENT])await finish();else setError("Purchase returned without the Bundle Membership entitlement.")}catch(e:any){setError(e.userCancelled?"Purchase cancelled.":e.message)}finally{setBusy(false)}}
  async function restore(){setRestoring(true);setError("");try{if(web)throw new Error("Membership restoration is available in the mobile app after launch.");const info=await Purchases.restorePurchases();if(info.entitlements.active[ENT])await finish();else setError("No active Bundle Membership was found.")}catch(e:any){setError(e.message)}finally{setRestoring(false)}}
  return <ScrollView contentContainerStyle={styles.scroll}><Text style={styles.brand}>BUNDLE MEMBERSHIP</Text><Text style={styles.title}>Membership unlocks dating.</Text><Text style={styles.subtitle}>$9.99/month. Verification is never sold as a paid service; membership becomes available only after Bundle approves the account.</Text><View style={styles.card}><Text style={{color:C.text,fontSize:25,fontWeight:"900"}}>$9.99 / month</Text>{web?<><Text style={styles.subtitle}>The website launch is free and does not collect membership payments. Complete the Bundle verification flow now; mobile membership billing remains unchanged for the App Store and Google Play release.</Text><Button title="Back to verification status" onPress={()=>router.replace("/onboarding")} /></>:<><Text style={styles.subtitle}>Auto-renewing through Apple App Store or Google Play. You can restore an existing purchase on the same store account.</Text><Button title="Start Membership" onPress={buy} loading={busy}/><Button title="Restore Membership" onPress={restore} loading={restoring} ghost/></>}{error?<Text style={styles.error}>{error}</Text>:null}</View></ScrollView>
}
