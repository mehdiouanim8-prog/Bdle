import { Platform } from "react-native";
import { getToken,getRefreshToken,updateAccessToken,clearToken,getDeviceId } from "./session";
let refreshing:Promise<string|null>|null=null;
const API=process.env.EXPO_PUBLIC_API_URL||"http://localhost:4000/api";

async function doRefresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    const r=await getRefreshToken();
    if(!r)return null;
    try{
      const res=await fetch(`${API}/auth/refresh`,{method:"POST",headers:{"Content-Type":"application/json","X-Bundle-Client":Platform.OS==="web"?"web":"mobile"},body:JSON.stringify({refreshToken:r})});
      if(!res.ok){await clearToken();return null}
      const d=await res.json();
      await updateAccessToken(d.token,d.refreshToken);
      return d.token;
    }catch{await clearToken();return null}
    finally{refreshing=null}
  })();
  return refreshing;
}

export async function api(path:string,options:RequestInit={},token?:string,retry=true){
  const access=token||await getToken();
  const headers:any={"Content-Type":"application/json",...(options.headers||{})};
  headers["X-Device-Id"]=await getDeviceId();
  headers["X-Bundle-Client"]=Platform.OS==="web"?"web":"mobile";
  if(access)headers.Authorization=`Bearer ${access}`;
  let r=await fetch(`${API}${path}`,{...options,headers});
  if(r.status===401&&retry&&!path.startsWith("/auth/refresh")){const next=await doRefresh();if(next)return api(path,options,next,false)}
  const d=await r.json().catch(()=>({}));
  if(!r.ok){const e:any=new Error(d.error||`Request failed (${r.status})`);e.code=d.code;e.status=r.status;throw e;}
  return d;
}
export const post=(path:string,body:any,token?:string)=>api(path,{method:"POST",body:JSON.stringify(body)},token);
export const put=(path:string,body:any,token?:string)=>api(path,{method:"PUT",body:JSON.stringify(body)},token);
export const del=(path:string,token?:string,body?:any)=>api(path,{method:"DELETE",...(body===undefined?{}:{body:JSON.stringify(body)})},token);
