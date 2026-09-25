import { Platform } from "react-native";
import { getStorageItem, setStorageItem, deleteStorageItem } from "./storage";

const ACCESS_KEY="bundle_access_token";
const REFRESH_KEY="bundle_refresh_token";
const DEVICE_KEY="bundle_device_id";
let access:string|null=null;
let refresh:string|null=null;

export async function setSession(a:string,r:string){
  access=a;
  refresh=r;
  await Promise.all([setStorageItem(ACCESS_KEY,a),setStorageItem(REFRESH_KEY,r)]);
}
export async function setToken(a:string){
  access=a;
  await setStorageItem(ACCESS_KEY,a);
}
export async function getToken(){
  if(access)return access;
  access=await getStorageItem(ACCESS_KEY);
  return access;
}
export async function getRefreshToken(){
  if(refresh)return refresh;
  refresh=await getStorageItem(REFRESH_KEY);
  return refresh;
}
export async function clearToken(){
  access=null;
  refresh=null;
  await Promise.all([deleteStorageItem(ACCESS_KEY),deleteStorageItem(REFRESH_KEY)]);
}
export async function updateAccessToken(a:string,r?:string){
  access=a;
  await setStorageItem(ACCESS_KEY,a);
  if(r){refresh=r;await setStorageItem(REFRESH_KEY,r);}
}

export async function getDeviceId(){
  let id=await getStorageItem(DEVICE_KEY);
  if(!id){
    id=cryptoRandomId();
    await setStorageItem(DEVICE_KEY,id);
  }
  return id;
}
function cryptoRandomId(){return `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}
