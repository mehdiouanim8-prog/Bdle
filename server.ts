import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Server as SocketIOServer } from "socket.io";
import { createServer } from "http";
import {
  PrismaClient, KycStatus, MembershipStatus, ProfileReviewStatus,
  VerificationStatus, UserRole, ModerationStatus, MessageStatus,
  ReportStatus, PhotoVerificationStatus, DeletionRequestStatus,
} from "@prisma/client";
import { z } from "zod";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

dotenv.config();
const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 4000);
const ACCESS_SECRET = process.env.JWT_SECRET || (isProd ? "" : "development-secret-change-me");
const accessMinutes = Number(process.env.ACCESS_TOKEN_MINUTES || 15);
const refreshDays = Number(process.env.REFRESH_TOKEN_DAYS || 30);
const origins = (process.env.CORS_ORIGINS || (isProd ? "" : "*")).split(",").map((x) => x.trim()).filter(Boolean);

function assertProductionConfig() {
  if (!isProd) return;
  const required: Record<string, string | undefined> = {
    JWT_SECRET: process.env.JWT_SECRET,
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
    DELETION_REQUEST_SECRET: process.env.DELETION_REQUEST_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    APP_BASE_URL: process.env.APP_BASE_URL,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_VERIFY_SERVICE_SID: process.env.TWILIO_VERIFY_SERVICE_SID,
    PERSONA_API_KEY: process.env.PERSONA_API_KEY,
    PERSONA_INQUIRY_TEMPLATE_ID: process.env.PERSONA_INQUIRY_TEMPLATE_ID,
    PERSONA_HOSTED_FLOW_BASE_URL: process.env.PERSONA_HOSTED_FLOW_BASE_URL,
    PERSONA_WEBHOOK_SECRET: process.env.PERSONA_WEBHOOK_SECRET,
    REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
    REVENUECAT_WEBHOOK_SIGNING_SECRET: process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET,
    REVENUECAT_API_KEY: process.env.REVENUECAT_API_KEY,
    REVENUECAT_ENTITLEMENT_ID: process.env.REVENUECAT_ENTITLEMENT_ID,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  };
  for (const [key, value] of Object.entries(required)) {
    if (!value) throw new Error(`Production configuration missing: ${key}`);
  }
  if (ACCESS_SECRET.length < 32 || process.env.REFRESH_TOKEN_SECRET!.length < 32) throw new Error("Production JWT secrets must be at least 32 characters.");
  if (!process.env.APP_BASE_URL!.startsWith("https://")) throw new Error("APP_BASE_URL must use HTTPS in production.");
  if (origins.includes("*")) throw new Error("CORS_ORIGINS cannot be * in production.");
}
assertProductionConfig();

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: origins.includes("*") ? true : origins, credentials: false }));
function captureRawBody(req: any, _res: any, buf: Buffer) { if (buf?.length) req.rawBody = buf; }
app.use(express.json({ limit: "2mb", verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const socketOrigins = origins.includes("*") ? true : origins;
const io = new SocketIOServer(httpServer, { cors: { origin: socketOrigins } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { error: "Too many verification attempts. Please try again later." } });
const messageLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25, standardHeaders: true, legacyHeaders: false });
const deletionLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false, message: { error: "Too many deletion requests. Please try again later." } });

function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function hashRefresh(value: string) { const secret=process.env.REFRESH_TOKEN_SECRET || "development-refresh-secret"; return crypto.createHmac("sha256",secret).update(value).digest("hex"); }
function hashDeletionCode(value: string) { const secret=process.env.DELETION_REQUEST_SECRET || "development-deletion-secret"; return crypto.createHmac("sha256",secret).update(value).digest("hex"); }
function randomCode() { return String(crypto.randomInt(100000, 1000000)); }
function signAccess(id: string) { return jwt.sign({ sub: id, typ: "access" }, ACCESS_SECRET, { expiresIn: `${accessMinutes}m` }); }
function uid(req: express.Request) { return (req as any).user.sub as string; }
function reqIp(req: express.Request) { return req.ip || req.socket.remoteAddress || "unknown"; }
function sessionDeviceId(req: express.Request) { return req.headers["x-device-id"]?.toString().slice(0, 200); }
function isWebClient(req: express.Request) { return String(req.headers["x-bundle-client"] || "").toLowerCase() === "web"; }

async function audit(action: string, entityType: string, entityId?: string, userId?: string, actorId?: string, req?: express.Request, metadata?: any) {
  await prisma.auditLog.create({ data: { action, entityType, entityId, userId, actorId, ipHash: req ? hash(reqIp(req)) : undefined, metadata } }).catch(() => undefined);
}

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
  try {
    const payload = jwt.verify(h.slice(7), ACCESS_SECRET) as any;
    if (payload.typ !== "access") throw new Error("wrong token type");
    (req as any).user = payload;
    next();
  } catch { return res.status(401).json({ error: "Invalid or expired session", code: "SESSION_EXPIRED" }); }
}

function requireRoles(...roles: UserRole[]) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const u = await prisma.user.findUnique({ where: { id: uid(req) }, select: { role: true, status: true } });
    if (!u || u.status !== "ACTIVE") return res.status(403).json({ error: "Staff account unavailable" });
    if (!roles.includes(u.role)) return res.status(403).json({ error: "Insufficient staff permissions" });
    (req as any).staffRole = u.role;
    next();
  };
}
const moderationStaff = requireRoles(UserRole.ADMIN, UserRole.MODERATOR);
const supportStaff = requireRoles(UserRole.ADMIN, UserRole.MODERATOR, UserRole.SUPPORT);
const adminOnly = requireRoles(UserRole.ADMIN);

async function datingAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  const u = await prisma.user.findUnique({ where: { id: uid(req) }, include: { profile: true, identityVerification: true, photoVerification: true, membership: true } });
  if (!u || u.status !== "ACTIVE") return res.status(401).json({ error: "Account unavailable" });
  if (u.emailStatus !== VerificationStatus.VERIFIED) return res.status(403).json({ error: "Email verification required", code: "EMAIL_REQUIRED" });
  if (!isWebClient(req) && u.phoneStatus !== VerificationStatus.VERIFIED) return res.status(403).json({ error: "Phone verification required", code: "PHONE_REQUIRED" });
  if (u.identityVerification?.status !== KycStatus.VERIFIED) return res.status(403).json({ error: "Identity verification required", code: "KYC_REQUIRED" });
  if (u.photoVerification?.status !== PhotoVerificationStatus.VERIFIED) return res.status(403).json({ error: "Photo verification required", code: "PHOTO_REQUIRED" });
  if (u.profile?.reviewStatus !== ProfileReviewStatus.APPROVED) return res.status(403).json({ error: "Profile approval required", code: "PROFILE_REVIEW_REQUIRED" });
  if (u.membership?.status !== MembershipStatus.ACTIVE || !u.membership.expiresAt || u.membership.expiresAt <= new Date()) return res.status(402).json({ error: "Active Bundle Membership required", code: "MEMBERSHIP_REQUIRED" });
  next();
}

async function createSession(userId: string, req: express.Request, deviceId?: string) {
  const refreshRaw = crypto.randomBytes(48).toString("base64url");
  const session = await prisma.session.create({ data: { userId, refreshTokenHash: hashRefresh(refreshRaw), deviceId, userAgent: req.headers["user-agent"]?.slice(0, 500), ipHash: hash(reqIp(req)), expiresAt: new Date(Date.now() + refreshDays * 86400000) } });
  return { accessToken: signAccess(userId), refreshToken: `${session.id}.${refreshRaw}` };
}

async function twilioVerify(action: "start" | "check", to: string, channel: "sms" | "email", code?: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID; const token = process.env.TWILIO_AUTH_TOKEN; const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !service) throw new Error("Twilio Verify is not configured");
  const endpoint = `https://verify.twilio.com/v2/Services/${service}/${action === "start" ? "Verifications" : "VerificationCheck"}`;
  const params = new URLSearchParams({ To: to, ...(action === "start" ? { Channel: channel } : { Code: code || "" }) });
  const r = await fetch(endpoint, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.message || "Verification provider request failed");
  return body as any;
}

async function personaRequest(path: string, init: RequestInit = {}) {
  const key = process.env.PERSONA_API_KEY;
  if (!key) throw new Error("Persona is not configured");
  const r = await fetch(`https://api.withpersona.com${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/vnd.api+json", ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.errors?.[0]?.detail || body?.message || "Persona request failed");
  return body as any;
}

function verifyTimestampHmac(rawBody: Buffer | undefined, header: string | undefined, secret: string | undefined) {
  if (!secret || !header || !rawBody) return false;
  const parts = Object.fromEntries(header.split(",").map(v => { const i = v.indexOf("="); return i > 0 ? [v.slice(0, i), v.slice(i + 1)] : [v, ""]; }));
  const t = Number(parts.t); const sig = parts.v1;
  if (!t || !sig || Math.abs(Math.floor(Date.now() / 1000) - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody.toString("utf8")}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch { return false; }
}

async function moderationText(text: string) {
  if (!process.env.OPENAI_API_KEY) return { configured: false, flagged: false, categories: {} };
  const r = await fetch("https://api.openai.com/v1/moderations", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.MODERATION_MODEL || "omni-moderation-latest", input: text }) });
  if (!r.ok) throw new Error("Content moderation service unavailable");
  const body = await r.json() as any;
  return { configured: true, flagged: Boolean(body?.results?.[0]?.flagged), categories: body?.results?.[0]?.categories || {} };
}

async function moderationImage(url: string) {
  if (!process.env.OPENAI_API_KEY) return { configured: false, flagged: false, categories: {} };
  const r = await fetch("https://api.openai.com/v1/moderations", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.MODERATION_MODEL || "omni-moderation-latest", input: [{ type: "image_url", image_url: { url } }] }) });
  if (!r.ok) throw new Error("Image moderation service unavailable");
  const body = await r.json() as any;
  return { configured: true, flagged: Boolean(body?.results?.[0]?.flagged), categories: body?.results?.[0]?.categories || {} };
}

const s3 = process.env.AWS_S3_BUCKET ? new S3Client({ region: process.env.AWS_REGION || "eu-west-3" }) : null;
async function signedUpload(userId: string, contentType: string, ext: string) {
  if (!s3 || !process.env.AWS_S3_BUCKET) throw new Error("Media storage is not configured");
  const key = `users/${userId}/${crypto.randomUUID()}.${ext}`;
  const command = new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key, ContentType: contentType, ServerSideEncryption: "AES256" });
  return { key, uploadUrl: await getSignedUrl(s3, command, { expiresIn: 600 }) };
}
async function mediaReadUrl(key: string) {
  if (!s3 || !process.env.AWS_S3_BUCKET) return undefined;
  const publicBase = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (publicBase) return `${publicBase}/${key}`;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }), { expiresIn: 3600 });
}
async function deleteMediaObject(key: string) { if (s3 && process.env.AWS_S3_BUCKET) await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key })).catch(() => undefined); }

function ageAt(date: Date) { const now = new Date(); let a = now.getUTCFullYear() - date.getUTCFullYear(); const m = now.getUTCMonth() - date.getUTCMonth(); if (m < 0 || (m === 0 && now.getUTCDate() < date.getUTCDate())) a--; return a; }
function profileCompleteness(p: any, photoCount: number) {
  const fields = [p.firstName, p.gender, p.lookingFor, p.city, p.bio, p.relationshipIntent, p.occupation, p.education];
  const populated = fields.filter(Boolean).length + (photoCount > 0 ? 1 : 0);
  return Math.round((populated / (fields.length + 1)) * 100);
}
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) { const r = 6371; const dLat = (bLat-aLat)*Math.PI/180; const dLon = (bLon-aLon)*Math.PI/180; const x = Math.sin(dLat/2)**2 + Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*Math.sin(dLon/2)**2; return 2*r*Math.atan2(Math.sqrt(x), Math.sqrt(1-x)); }

async function notify(userId: string, type: string, title: string, body: string, data?: any, force = false) {
  const pref = await prisma.notificationPreference.findUnique({ where: { userId } });
  const group = type === "MESSAGE" ? "pushMessages" : type === "MATCH" ? "pushMatches" : type === "LIKE" ? "pushLikes" : type.startsWith("VERIFY") || type.startsWith("PHOTO") ? "pushVerification" : type.includes("MEMBERSHIP") ? "pushMembership" : type.startsWith("SAFETY") || type.startsWith("REPORT") ? "pushSafety" : "pushMessages";
  const allowed = force || !pref || Boolean((pref as any)[group]);
  const note = await prisma.notification.create({ data: { userId, type, title, body, data } });
  if (!allowed) return note;
  const tokens = await prisma.pushToken.findMany({ where: { userId }, select: { token: true } });
  if (tokens.length) {
    const messages = tokens.map(t => ({ to: t.token, sound: "default", title, body, data: data || {} })).slice(0, 100);
    fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(messages) }).catch(() => undefined);
  }
  return note;
}

async function sendTransactionalEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY; const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) throw new Error("Transactional email is not configured");
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html }) });
  if (!r.ok) throw new Error("Unable to send email");
}

app.get("/api/health", async (_req,res) => {
  try { await prisma.$queryRaw`SELECT 1`; const base:any={ok:true,app:"Bundle",mode:isProd?"production":"development",database:true}; if(!isProd)base.integrations={twilio:Boolean(process.env.TWILIO_VERIFY_SERVICE_SID),persona:Boolean(process.env.PERSONA_API_KEY),revenueCat:Boolean(process.env.REVENUECAT_WEBHOOK_AUTH),storage:Boolean(process.env.AWS_S3_BUCKET),moderation:Boolean(process.env.OPENAI_API_KEY),email:Boolean(process.env.RESEND_API_KEY)}; res.json(base); }
  catch { res.status(503).json({ ok:false, app:"Bundle", database:false }); }
});

// ---------- Authentication ----------
app.post("/api/auth/register", authLimiter, async (req,res) => {
  const p = z.object({ email:z.string().email(), password:z.string().min(10).max(100), termsVersion:z.string().min(1).max(100), privacyVersion:z.string().min(1).max(100), marketingOptIn:z.boolean().default(false) }).safeParse(req.body);
  if(!p.success) return res.status(400).json({error:"Use a valid email and a password of at least 10 characters, and accept the current terms."});
  const email = p.data.email.toLowerCase().trim();
  if(await prisma.user.findUnique({where:{email}})) return res.status(409).json({error:"Email already registered"});
  const now = new Date();
  const u = await prisma.user.create({ data:{
    email, passwordHash:await bcrypt.hash(p.data.password,12),
    identityVerification:{create:{}}, photoVerification:{create:{}}, membership:{create:{}}, preference:{create:{}}, notificationPreference:{create:{}},
    consentRecords:{create:[{type:"TERMS",version:p.data.termsVersion,ipHash:hash(reqIp(req))},{type:"PRIVACY",version:p.data.privacyVersion,ipHash:hash(reqIp(req))}, ...(p.data.marketingOptIn?[{type:"MARKETING",version:"v1",ipHash:hash(reqIp(req))}]:[])]}
  }});
  try { await twilioVerify("start",email,"email"); }
  catch(e:any) { await prisma.user.delete({where:{id:u.id}}); return res.status(502).json({error:e.message}); }
  const sess=await createSession(u.id,req,sessionDeviceId(req)); await audit("REGISTER","USER",u.id,u.id,undefined,req,{at:now.toISOString()});
  res.status(201).json({token:sess.accessToken,refreshToken:sess.refreshToken,userId:u.id,next:"EMAIL_VERIFICATION"});
});

app.post("/api/auth/login", authLimiter, async(req,res)=>{
  const p=z.object({email:z.string().email(),password:z.string(),deviceId:z.string().optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Invalid credentials"});
  const u=await prisma.user.findUnique({where:{email:p.data.email.toLowerCase().trim()},include:{membership:true,identityVerification:true,photoVerification:true,profile:true}});
  if(!u||u.status!=="ACTIVE"||(await bcrypt.compare(p.data.password,u.passwordHash))===false)return res.status(401).json({error:"Invalid credentials"});
  await prisma.user.update({where:{id:u.id},data:{lastActiveAt:new Date()}});
  const sess=await createSession(u.id,req,p.data.deviceId||sessionDeviceId(req)); await audit("LOGIN","USER",u.id,u.id,undefined,req);
  res.json({token:sess.accessToken,refreshToken:sess.refreshToken,emailVerified:u.emailStatus===VerificationStatus.VERIFIED,phoneVerified:u.phoneStatus===VerificationStatus.VERIFIED,kycStatus:u.identityVerification?.status||"NOT_STARTED",photoVerificationStatus:u.photoVerification?.status||"NOT_STARTED",profileReviewStatus:u.profile?.reviewStatus||"NOT_SUBMITTED",membershipStatus:u.membership?.status||"INACTIVE"});
});

app.post("/api/auth/refresh", authLimiter, async(req,res)=>{
  const p=z.object({refreshToken:z.string().min(50)}).safeParse(req.body); if(!p.success)return res.status(400).json({error:"Refresh token required"});
  const dot=p.data.refreshToken.indexOf("."); if(dot<10)return res.status(401).json({error:"Invalid refresh session"});
  const sessionId=p.data.refreshToken.slice(0,dot); const raw=p.data.refreshToken.slice(dot+1);
  const session=await prisma.session.findUnique({where:{id:sessionId},include:{user:true}});
  if(!session||session.revokedAt||session.expiresAt<=new Date()||session.refreshTokenHash!==hashRefresh(raw)||session.user.status!=="ACTIVE")return res.status(401).json({error:"Invalid refresh session"});
  await prisma.session.update({where:{id:session.id},data:{revokedAt:new Date(),lastUsedAt:new Date()}});
  const next=await createSession(session.userId,req,session.deviceId||sessionDeviceId(req));
  res.json({token:next.accessToken,refreshToken:next.refreshToken});
});

app.post("/api/auth/logout", auth, async(req,res)=>{await prisma.session.updateMany({where:{userId:uid(req),revokedAt:null},data:{revokedAt:new Date()}});await audit("LOGOUT","USER",uid(req),uid(req),undefined,req);res.json({loggedOut:true});});
app.post("/api/auth/email/send", auth, otpLimiter, async(req,res)=>{const u=await prisma.user.findUnique({where:{id:uid(req)}});if(!u)return res.status(404).json({error:"Account not found"});if(u.emailStatus===VerificationStatus.VERIFIED)return res.json({sent:false,alreadyVerified:true});try{const r=await twilioVerify("start",u.email,"email");res.json({sent:true,status:r.status});}catch(e:any){res.status(502).json({error:e.message});}});
app.post("/api/auth/email/verify", auth, otpLimiter, async(req,res)=>{const p=z.object({code:z.string().regex(/^\d{4,10}$/)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Enter the verification code"});const u=await prisma.user.findUnique({where:{id:uid(req)}});if(!u)return res.status(404).json({error:"Account not found"});try{const r=await twilioVerify("check",u.email,"email",p.data.code);if(r.status!=="approved")return res.status(400).json({error:"Incorrect or expired email code"});}catch(e:any){return res.status(400).json({error:e.message});}await prisma.user.update({where:{id:u.id},data:{emailStatus:VerificationStatus.VERIFIED,lastActiveAt:new Date()}});await audit("EMAIL_VERIFIED","USER",u.id,u.id,undefined,req);res.json({verified:true,next:isWebClient(req)?"PROFILE":"PHONE_VERIFICATION"});});
app.post("/api/auth/phone", auth, otpLimiter, async(req,res)=>{if(isWebClient(req))return res.status(404).json({error:"Phone verification is not part of the web experience."});const p=z.object({phoneNumber:z.string().regex(/^\+[1-9]\d{7,14}$/)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Use an international E.164 phone number, e.g. +212612345678"});const exists=await prisma.user.findFirst({where:{phoneNumber:p.data.phoneNumber,id:{not:uid(req)}}});if(exists)return res.status(409).json({error:"That phone number is already in use"});await prisma.user.update({where:{id:uid(req)},data:{phoneNumber:p.data.phoneNumber,phoneStatus:VerificationStatus.UNVERIFIED}});try{const r=await twilioVerify("start",p.data.phoneNumber,"sms");res.json({sent:true,status:r.status});}catch(e:any){res.status(502).json({error:e.message});}});
app.post("/api/auth/phone/resend", auth, otpLimiter, async(req,res)=>{if(isWebClient(req))return res.status(404).json({error:"Phone verification is not part of the web experience."});const u=await prisma.user.findUnique({where:{id:uid(req)}});if(!u?.phoneNumber)return res.status(400).json({error:"Set a phone number first"});try{const r=await twilioVerify("start",u.phoneNumber,"sms");res.json({sent:true,status:r.status});}catch(e:any){res.status(502).json({error:e.message});}});

app.post("/api/auth/phone/verify", auth, otpLimiter, async(req,res)=>{if(isWebClient(req))return res.status(404).json({error:"Phone verification is not part of the web experience."});const p=z.object({code:z.string().regex(/^\d{4,10}$/)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Enter the verification code"});const u=await prisma.user.findUnique({where:{id:uid(req)}});if(!u?.phoneNumber)return res.status(400).json({error:"Set a phone number first"});try{const r=await twilioVerify("check",u.phoneNumber,"sms",p.data.code);if(r.status!=="approved")return res.status(400).json({error:"Incorrect or expired phone code"});}catch(e:any){return res.status(400).json({error:e.message});}await prisma.user.update({where:{id:u.id},data:{phoneStatus:VerificationStatus.VERIFIED,lastActiveAt:new Date()}});await audit("PHONE_VERIFIED","USER",u.id,u.id,undefined,req);res.json({verified:true,next:"PROFILE"});});

app.put("/api/account/password", auth, authLimiter, async(req,res)=>{const p=z.object({currentPassword:z.string().min(1),newPassword:z.string().min(10).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Use a new password of at least 10 characters."});const u=await prisma.user.findUnique({where:{id:uid(req)}});if(!u||!(await bcrypt.compare(p.data.currentPassword,u.passwordHash)))return res.status(401).json({error:"Current password is incorrect"});await prisma.user.update({where:{id:u.id},data:{passwordHash:await bcrypt.hash(p.data.newPassword,12)}});await prisma.session.updateMany({where:{userId:u.id,revokedAt:null},data:{revokedAt:new Date()}});const sess=await createSession(u.id,req,sessionDeviceId(req));await audit("PASSWORD_CHANGED","USER",u.id,u.id,undefined,req);res.json({changed:true,token:sess.accessToken,refreshToken:sess.refreshToken});});
app.put("/api/account/email", auth, authLimiter, async(req,res)=>{const p=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Valid email and current password are required"});const u=await prisma.user.findUnique({where:{id:uid(req)}});if(!u||!(await bcrypt.compare(p.data.password,u.passwordHash)))return res.status(401).json({error:"Current password is incorrect"});const email=p.data.email.toLowerCase().trim();const exists=await prisma.user.findFirst({where:{email,id:{not:u.id}}});if(exists)return res.status(409).json({error:"That email is already in use"});await prisma.user.update({where:{id:u.id},data:{email,emailStatus:VerificationStatus.UNVERIFIED}});try{await twilioVerify("start",email,"email");}catch(e:any){return res.status(502).json({error:e.message});}await audit("EMAIL_CHANGE_REQUESTED","USER",u.id,u.id,undefined,req,{email});res.json({changed:true,next:"EMAIL_VERIFICATION"});});
app.put("/api/account/phone", auth, authLimiter, async(req,res)=>{if(isWebClient(req))return res.status(404).json({error:"Phone verification is not part of the web experience."});const p=z.object({phoneNumber:z.string().regex(/^\+[1-9]\d{7,14}$/),password:z.string().min(1)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Use an international E.164 phone number and your current password"});const u=await prisma.user.findUnique({where:{id:uid(req)}});if(!u||!(await bcrypt.compare(p.data.password,u.passwordHash)))return res.status(401).json({error:"Current password is incorrect"});const exists=await prisma.user.findFirst({where:{phoneNumber:p.data.phoneNumber,id:{not:u.id}}});if(exists)return res.status(409).json({error:"That phone number is already in use"});await prisma.user.update({where:{id:u.id},data:{phoneNumber:p.data.phoneNumber,phoneStatus:VerificationStatus.UNVERIFIED}});try{await twilioVerify("start",p.data.phoneNumber,"sms");}catch(e:any){return res.status(502).json({error:e.message});}await audit("PHONE_CHANGE_REQUESTED","USER",u.id,u.id,undefined,req);res.json({changed:true,next:"PHONE_VERIFICATION"});});

app.post("/api/auth/password/forgot", authLimiter, async(req,res)=>{
  const p=z.object({email:z.string().email()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Enter a valid email address."});
  const email=p.data.email.toLowerCase().trim(); const u=await prisma.user.findUnique({where:{email}});
  let developmentResetToken:string|undefined;
  if(u){
    await prisma.passwordResetToken.deleteMany({where:{userId:u.id,usedAt:null}});
    const token=crypto.randomBytes(32).toString("hex"); developmentResetToken=token; const expiresAt=new Date(Date.now()+15*60*1000);
    await prisma.passwordResetToken.create({data:{userId:u.id,tokenHash:hash(token),expiresAt}});
    const link=`${(process.env.APP_BASE_URL||"http://localhost:8081").replace(/\/$/,"")}/reset-password.html?token=${token}&email=${encodeURIComponent(email)}`;
    if(process.env.RESEND_API_KEY&&process.env.RESEND_FROM_EMAIL){await sendTransactionalEmail(email,"Reset your Bundle password",`<p>We received a request to reset your Bundle password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 15 minutes. If you did not request this, you can ignore this email.</p>`).catch(()=>undefined);}
  }
  // Never reveal whether an account exists. Only expose a temporary token in local development.
  res.json({sent:true,...(!isProd?{developmentResetToken:developmentResetToken||null}: {})});
});
app.post("/api/auth/password/reset", authLimiter, async(req,res)=>{
  const p=z.object({email:z.string().email(),token:z.string().min(40),newPassword:z.string().min(10).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid password reset request"});
  const u=await prisma.user.findUnique({where:{email:p.data.email.toLowerCase().trim()}});if(!u)return res.status(400).json({error:"Invalid or expired reset token"});
  const record=await prisma.passwordResetToken.findFirst({where:{userId:u.id,tokenHash:hash(p.data.token),usedAt:null,expiresAt:{gt:new Date()}}});if(!record)return res.status(400).json({error:"Invalid or expired reset token"});
  await prisma.$transaction([prisma.user.update({where:{id:u.id},data:{passwordHash:await bcrypt.hash(p.data.newPassword,12)}}),prisma.passwordResetToken.update({where:{id:record.id},data:{usedAt:new Date()}}),prisma.session.updateMany({where:{userId:u.id,revokedAt:null},data:{revokedAt:new Date()}})]);
  await audit("PASSWORD_RESET_COMPLETED","USER",u.id,u.id,undefined,req);res.json({reset:true});
});

// ---------- User / onboarding ----------
app.get("/api/me", auth, async(req,res)=>{
  const u=await prisma.user.findUnique({where:{id:uid(req)},include:{profile:{include:{photos:{orderBy:{order:"asc"}}}},identityVerification:true,photoVerification:true,membership:true,preference:true,location:true,notificationPreference:true}});if(!u)return res.status(404).json({error:"Account not found"});
  const profile=u.profile?{...u.profile,photos:await Promise.all(u.profile.photos.map(async p=>({...p,url:await mediaReadUrl(p.key)})))}:null;
  res.json({id:u.id,email:u.email,phoneNumber:u.phoneNumber,emailStatus:u.emailStatus,phoneStatus:u.phoneStatus,ageEligible:u.ageEligible,status:u.status,role:u.role,profile,kyc:u.identityVerification,photoVerification:u.photoVerification,membership:u.membership,preference:u.preference,location:u.location,notificationPreference:u.notificationPreference});
});

app.put("/api/profile", auth, async(req,res)=>{
  const p=z.object({firstName:z.string().trim().min(1).max(50),birthDate:z.string(),bio:z.string().trim().max(1000).optional(),gender:z.string().min(1).max(50),lookingFor:z.string().min(1).max(50),city:z.string().trim().min(1).max(100),relationshipIntent:z.string().max(100).optional(),occupation:z.string().max(100).optional(),education:z.string().max(100).optional(),heightCm:z.number().int().min(120).max(230).optional(),languages:z.array(z.string().max(30)).max(10).default([]),interests:z.array(z.string().max(40)).max(30).default([]),prompts:z.any().optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Complete all profile fields correctly"});
  const birth=new Date(p.data.birthDate);if(Number.isNaN(birth.getTime()))return res.status(400).json({error:"Enter a valid birth date"});const age=ageAt(birth);if(age<18||age>120)return res.status(400).json({error:"Bundle is for adults 18 and over"});
  if(p.data.bio){const mod=await moderationText(p.data.bio);if(mod.configured&&mod.flagged)return res.status(400).json({error:"Your bio cannot be published because it violates Bundle community standards."});}
  const existing=await prisma.profile.findUnique({where:{userId:uid(req)}}); const photoCount=await prisma.media.count({where:{userId:uid(req),profileId:existing?.id,moderationStatus:ModerationStatus.APPROVED}});
  const completeness=profileCompleteness(p.data,photoCount);
  const profile=await prisma.profile.upsert({where:{userId:uid(req)},create:{userId:uid(req),...p.data,birthDate:birth,reviewStatus:ProfileReviewStatus.PENDING,completeness},update:{...p.data,birthDate:birth,reviewStatus:ProfileReviewStatus.PENDING,reviewReason:null,completeness}});
  await prisma.user.update({where:{id:uid(req)},data:{ageEligible:true,lastActiveAt:new Date()}});
  await audit("PROFILE_SUBMITTED","PROFILE",profile.id,uid(req),undefined,req,{completeness});res.json(profile);
});

app.get("/api/preferences",auth,async(req,res)=>res.json(await prisma.preference.findUnique({where:{userId:uid(req)}})||{minAge:18,maxAge:99,maxDistanceKm:50,genderPreference:null,relationshipIntent:null,interests:[]}));
app.put("/api/preferences",auth,async(req,res)=>{const p=z.object({minAge:z.number().int().min(18).max(99),maxAge:z.number().int().min(18).max(120),maxDistanceKm:z.number().int().min(1).max(500),genderPreference:z.string().max(50).optional().nullable(),relationshipIntent:z.string().max(100).optional().nullable(),interests:z.array(z.string().max(40)).max(30).default([])}).safeParse(req.body);if(!p.success||p.data.minAge>p.data.maxAge)return res.status(400).json({error:"Invalid dating preferences"});res.json(await prisma.preference.upsert({where:{userId:uid(req)},create:{userId:uid(req),...p.data},update:p.data}));});

app.post("/api/location",auth,async(req,res)=>{const p=z.object({latitude:z.number().gte(-90).lte(90),longitude:z.number().gte(-180).lte(180),city:z.string().max(100).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid location"});res.json(await prisma.location.upsert({where:{userId:uid(req)},create:{userId:uid(req),...p.data},update:p.data}));});

// ---------- Media ----------
app.post("/api/media/upload-url",auth,uploadLimiter,async(req,res)=>{const p=z.object({contentType:z.enum(["image/jpeg","image/png","image/webp","image/heic"]),extension:z.string().regex(/^[a-z0-9]{2,5}$/i)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Unsupported image type"});try{res.json(await signedUpload(uid(req),p.data.contentType,p.data.extension));}catch(e:any){res.status(503).json({error:e.message});}});
app.post("/api/media",auth,uploadLimiter,async(req,res)=>{const p=z.object({key:z.string().regex(/^users\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\.[A-Za-z0-9]+$/),type:z.literal("IMAGE"),order:z.number().int().min(0).max(20).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid media"});if(!p.data.key.startsWith(`users/${uid(req)}/`))return res.status(403).json({error:"Media ownership mismatch"});
  const existingCount=await prisma.media.count({where:{userId:uid(req)}});if(existingCount>=6)return res.status(400).json({error:"Bundle profiles can contain up to 6 photos."});
  if(s3&&process.env.AWS_S3_BUCKET){try{await s3.send(new HeadObjectCommand({Bucket:process.env.AWS_S3_BUCKET,Key:p.data.key}));}catch{return res.status(404).json({error:"Uploaded media object was not found."});}}
  const profile=await prisma.profile.findUnique({where:{userId:uid(req)},select:{id:true}});
  const row=await prisma.media.create({data:{userId:uid(req),profileId:profile?.id,key:p.data.key,type:p.data.type,order:p.data.order??existingCount}});
  let status:ModerationStatus=ModerationStatus.PENDING;
  let reason:string|undefined;
  let categories:any=undefined;
  try { const url=await mediaReadUrl(row.key); if(url&&process.env.OPENAI_API_KEY){const mod=await moderationImage(url);status=mod.flagged?ModerationStatus.REJECTED:ModerationStatus.APPROVED;reason=mod.flagged?"Automated safety screening flagged this image.":undefined;categories=mod.categories;} }
  catch(e:any){reason="Automated review unavailable; manual review required.";}
  const updated=await prisma.media.update({where:{id:row.id},data:{moderationStatus:status,moderationReason:reason,moderationCategories:categories}});
  if(status===ModerationStatus.APPROVED){
    await prisma.profile.updateMany({where:{userId:uid(req)},data:{reviewStatus:ProfileReviewStatus.PENDING,reviewReason:"Your profile has new or changed photos and needs review."}});
    await prisma.photoVerification.updateMany({where:{userId:uid(req),status:PhotoVerificationStatus.VERIFIED},data:{status:PhotoVerificationStatus.PENDING,rejectionReason:null,verifiedAt:null}});
  }
  if(status===ModerationStatus.REJECTED) await audit("MEDIA_REJECTED_BY_MODERATION","MEDIA",row.id,uid(req),undefined,req,{categories});
  res.status(201).json({...updated,url:await mediaReadUrl(updated.key)});
});
app.delete("/api/media/:id",auth,async(req,res)=>{const row=await prisma.media.findFirst({where:{id:req.params.id,userId:uid(req)}});if(!row)return res.status(404).json({error:"Photo not found"});await deleteMediaObject(row.key);await prisma.media.delete({where:{id:row.id}});await prisma.profile.updateMany({where:{userId:uid(req)},data:{reviewStatus:ProfileReviewStatus.PENDING,reviewReason:"Your profile photos changed and need review."}});await prisma.photoVerification.updateMany({where:{userId:uid(req),status:PhotoVerificationStatus.VERIFIED},data:{status:PhotoVerificationStatus.PENDING,rejectionReason:null,verifiedAt:null}});await audit("MEDIA_DELETED","MEDIA",row.id,uid(req),undefined,req);res.json({deleted:true});});
app.patch("/api/media/:id",auth,async(req,res)=>{const p=z.object({order:z.number().int().min(0).max(20)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid order"});const row=await prisma.media.findFirst({where:{id:req.params.id,userId:uid(req)}});if(!row)return res.status(404).json({error:"Photo not found"});res.json(await prisma.media.update({where:{id:row.id},data:{order:p.data.order}}));});

// ---------- Identity / verification ----------
app.post("/api/kyc/start",auth,async(req,res)=>{
  const p=z.object({documentType:z.enum(["GOVERNMENT_ID","PASSPORT"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Choose a valid document type"});
  const templateId=process.env.PERSONA_TEMPLATE_ID;if(!templateId)return res.status(503).json({error:"Identity verification is not configured"});
  const referenceId=uid(req); const body:any={data:{type:"inquiry",attributes:{inquiry_template_id:templateId,reference_id:referenceId,fields:{document_type:p.data.documentType}}}};
  try { const created=await personaRequest("/api/v1/inquiries",{method:"POST",body:JSON.stringify(body)}); const inquiry=created?.data;const ref=inquiry?.id;if(!ref)throw new Error("Persona did not return an inquiry id"); await prisma.identityVerification.upsert({where:{userId:uid(req)},create:{userId:uid(req),status:KycStatus.PENDING,provider:"PERSONA",providerRef:ref,documentType:p.data.documentType,submittedAt:new Date()},update:{status:KycStatus.PENDING,provider:"PERSONA",providerRef:ref,documentType:p.data.documentType,submittedAt:new Date(),verifiedAt:null,rejectedAt:null,rejectionReason:null}});const hosted=process.env.PERSONA_HOSTED_FLOW_BASE_URL?`${process.env.PERSONA_HOSTED_FLOW_BASE_URL.replace(/\/$/,"")}/${ref}`:undefined;res.json({status:"PENDING",inquiryId:ref,hostedUrl:hosted}); }
  catch(e:any){res.status(502).json({error:e.message});}
});
app.get("/api/kyc/status",auth,async(req,res)=>res.json(await prisma.identityVerification.findUnique({where:{userId:uid(req)}})||{status:KycStatus.NOT_STARTED}));
app.post("/api/photo-verification/start",auth,async(req,res)=>{const k=await prisma.identityVerification.findUnique({where:{userId:uid(req)}});if(k?.status!==KycStatus.VERIFIED)return res.status(403).json({error:"Identity verification must be complete first."});const existing=await prisma.photoVerification.findUnique({where:{userId:uid(req)}});if(existing?.status===PhotoVerificationStatus.VERIFIED)return res.json(existing);const v=await prisma.photoVerification.upsert({where:{userId:uid(req)},create:{userId:uid(req),status:PhotoVerificationStatus.PENDING,provider:"BUNDLE_REVIEW"},update:{status:PhotoVerificationStatus.PENDING,rejectionReason:null}});res.json({status:v.status,provider:v.provider,message:"Your live identity is verified. Bundle will now review your profile photos."});});
app.get("/api/photo-verification/status",auth,async(req,res)=>res.json(await prisma.photoVerification.findUnique({where:{userId:uid(req)}})||{status:PhotoVerificationStatus.NOT_STARTED}));
app.get("/api/profile/review",auth,async(req,res)=>res.json(await prisma.profile.findUnique({where:{userId:uid(req)},select:{reviewStatus:true,reviewReason:true}})||{reviewStatus:ProfileReviewStatus.NOT_SUBMITTED}));

app.post("/api/webhooks/persona",async(req:any,res)=>{
  const signature=req.headers["persona-signature"] as string|undefined;
  if(!verifyTimestampHmac(req.rawBody,signature,process.env.PERSONA_WEBHOOK_SECRET))return res.status(401).json({error:"Invalid signature"});
  const payload=req.body; const eventId=payload?.data?.id||payload?.id;if(!eventId)return res.status(400).json({error:"Missing event id"});
  try{await prisma.webhookEvent.create({data:{id:`PERSONA:${eventId}`,provider:"PERSONA"}});}catch{return res.json({received:true,duplicate:true});}
  const name=String(payload?.name||payload?.event||payload?.type||"").toLowerCase();const inquiryId=payload?.data?.relationships?.inquiry?.data?.id||payload?.data?.attributes?.inquiry_id||payload?.data?.id;
  const v=inquiryId?await prisma.identityVerification.findFirst({where:{provider:"PERSONA",providerRef:inquiryId}}):null;
  if(v){
    if(name.includes("inquiry.approved")){await prisma.identityVerification.update({where:{id:v.id},data:{status:KycStatus.VERIFIED,verifiedAt:new Date(),rejectedAt:null,rejectionReason:null}});await notify(v.userId,"VERIFY_IDENTITY","Identity verified","Your Bundle identity verification is complete.");}
    else if(name.includes("marked-for-review")){await audit("PERSONA_MANUAL_REVIEW","IDENTITY_VERIFICATION",v.id,v.userId,undefined,undefined,{event:name});}
    else if(name.includes("inquiry.declined")||name.includes("inquiry.failed")||name.includes("inquiry.expired")){await prisma.identityVerification.update({where:{id:v.id},data:{status:KycStatus.REJECTED,rejectedAt:new Date(),rejectionReason:"Identity provider did not approve the verification."}});await notify(v.userId,"VERIFY_IDENTITY","Identity verification needs attention","Please review Bundle verification and try again.",undefined,true);}
    await audit("PERSONA_WEBHOOK","IDENTITY_VERIFICATION",v.id,v.userId,undefined,undefined,{event:name});
  }
  res.json({received:true});
});

async function syncRevenueCatMembership(userId:string){
  const apiKey=process.env.REVENUECAT_API_KEY;const entitlementId=process.env.REVENUECAT_ENTITLEMENT_ID||"bundle_membership";
  if(!apiKey)return false;
  try{
    const r=await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,{headers:{Authorization:`Bearer ${apiKey}`}});
    if(!r.ok)return false;
    const body:any=await r.json();const ent=body?.subscriber?.entitlements?.[entitlementId];
    const expires=ent?.expires_date?new Date(ent.expires_date):null;
    const active=Boolean(ent)&&(!expires||expires>new Date());
    const user=await prisma.user.findUnique({where:{id:userId},include:{identityVerification:true,photoVerification:true,profile:true}});
    const eligible=Boolean(user&&user.emailStatus===VerificationStatus.VERIFIED&&user.phoneStatus===VerificationStatus.VERIFIED&&user.identityVerification?.status===KycStatus.VERIFIED&&user.photoVerification?.status===PhotoVerificationStatus.VERIFIED&&user.profile?.reviewStatus===ProfileReviewStatus.APPROVED);
    if(active&&eligible){await prisma.membership.upsert({where:{userId},create:{userId,status:MembershipStatus.ACTIVE,plan:process.env.BUNDLE_MONTHLY_PLAN||"MONTHLY_9_99",provider:"REVENUECAT",externalId:ent?.product_identifier||null,expiresAt:expires},update:{status:MembershipStatus.ACTIVE,plan:process.env.BUNDLE_MONTHLY_PLAN||"MONTHLY_9_99",provider:"REVENUECAT",externalId:ent?.product_identifier||null,expiresAt:expires,gracePeriodExpiresAt:null}});return true;}
    if(!active)await prisma.membership.updateMany({where:{userId,provider:"REVENUECAT"},data:{status:MembershipStatus.EXPIRED,expiresAt:expires||new Date(),gracePeriodExpiresAt:null}});
    return false;
  }catch{return false;}
}

// ---------- Membership ----------
app.get("/api/membership",auth,async(req,res)=>res.json(await prisma.membership.findUnique({where:{userId:uid(req)}})||{status:MembershipStatus.INACTIVE,plan:process.env.BUNDLE_MONTHLY_PLAN||"MONTHLY_9_99"}));
app.post("/api/webhooks/revenuecat",async(req:any,res)=>{
  const authExpected=process.env.REVENUECAT_WEBHOOK_AUTH;
  if(authExpected && req.headers.authorization!==authExpected)return res.status(401).json({error:"Unauthorized"});
  const secret=process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET;
  if(secret&&!verifyTimestampHmac(req.rawBody,req.headers["x-revenuecat-webhook-signature"] as string|undefined,secret))return res.status(401).json({error:"Invalid signature"});
  const event=req.body?.event;const eventId=event?.id;if(!eventId)return res.status(400).json({error:"Missing event id"});
  try{await prisma.webhookEvent.create({data:{id:`REVENUECAT:${eventId}`,provider:"REVENUECAT"}});}catch{return res.json({received:true,duplicate:true});}
  const appUserId=event?.app_user_id as string|undefined;if(!appUserId)return res.json({received:true});
  const u=await prisma.user.findUnique({where:{id:appUserId}});if(!u)return res.json({received:true});
  const type=String(event?.type||"").toUpperCase();if(isProd&&!process.env.ALLOW_PROVIDER_SANDBOX_IN_PRODUCTION&&String(event?.environment||"").toUpperCase()==="SANDBOX")return res.status(202).json({received:true,ignored:"sandbox_event"});const exp=event?.expiration_at_ms?new Date(Number(event.expiration_at_ms)):undefined;const purchased=event?.purchased_at_ms?new Date(Number(event.purchased_at_ms)):undefined;const grace=event?.grace_period_expiration_at_ms?new Date(Number(event.grace_period_expiration_at_ms)):undefined;const entitlements=Array.isArray(event?.entitlement_ids)?event.entitlement_ids:[];const required=process.env.REVENUECAT_ENTITLEMENT_ID;const hasEntitlement=!required||entitlements.includes(required);
  await prisma.subscriptionEvent.create({data:{id:`RC:${eventId}`,provider:"REVENUECAT",userId:u.id,type,environment:event?.environment,productId:event?.product_id,entitlementIds:entitlements,transactionId:event?.transaction_id,originalTransactionId:event?.original_transaction_id,purchasedAt:purchased,expirationAt:exp,gracePeriodExpirationAt:grace,eventTimestamp:event?.event_timestamp_ms?new Date(Number(event.event_timestamp_ms)):new Date(),payload:event}}).catch(()=>undefined);
  const plan=process.env.BUNDLE_MONTHLY_PLAN||"MONTHLY_9_99";
  if(hasEntitlement && ["INITIAL_PURCHASE","RENEWAL","UNCANCELLATION","SUBSCRIPTION_EXTENDED","NON_RENEWING_PURCHASE"].includes(type)){
    const eligible=await prisma.user.findUnique({where:{id:u.id},include:{profile:true,identityVerification:true,photoVerification:true}});
    const accessReady=Boolean(eligible&&eligible.emailStatus===VerificationStatus.VERIFIED&&eligible.phoneStatus===VerificationStatus.VERIFIED&&eligible.identityVerification?.status===KycStatus.VERIFIED&&eligible.photoVerification?.status===PhotoVerificationStatus.VERIFIED&&eligible.profile?.reviewStatus===ProfileReviewStatus.APPROVED);
    await prisma.membership.upsert({where:{userId:u.id},create:{userId:u.id,status:accessReady?MembershipStatus.ACTIVE:MembershipStatus.INACTIVE,plan,provider:"REVENUECAT",externalId:event?.transaction_id||event?.original_transaction_id,expiresAt:exp,cancelAt:null,gracePeriodExpiresAt:grace},update:{status:accessReady?MembershipStatus.ACTIVE:MembershipStatus.INACTIVE,plan,provider:"REVENUECAT",externalId:event?.transaction_id||event?.original_transaction_id,expiresAt:exp,cancelAt:null,gracePeriodExpiresAt:grace}});
    if(accessReady)await notify(u.id,"MEMBERSHIP_ACTIVE","Bundle Membership active","Your $9.99 Bundle Membership is active.",undefined,true); else await audit("MEMBERSHIP_HELD_UNTIL_APPROVAL","MEMBERSHIP",undefined,u.id,undefined,undefined,{reason:"Subscription event received before verification/profile approval"});
  } else if(type==="CANCELLATION"){
    await prisma.membership.updateMany({where:{userId:u.id},data:{cancelAt:exp||new Date(),gracePeriodExpiresAt:grace}});
  } else if(type==="BILLING_ISSUE"){
    await prisma.membership.updateMany({where:{userId:u.id},data:{gracePeriodExpiresAt:grace}});
    await notify(u.id,"MEMBERSHIP_BILLING","Billing issue","There is a problem with your Bundle Membership payment. Please update your billing method in the store.",undefined,true);
  } else if(["EXPIRATION","REFUND"].includes(type)){
    await prisma.membership.updateMany({where:{userId:u.id},data:{status:MembershipStatus.EXPIRED,expiresAt:exp||new Date(),gracePeriodExpiresAt:null}});
  } else if(type==="REFUND_REVERSED"){
    if(exp&&exp>new Date()) await prisma.membership.updateMany({where:{userId:u.id},data:{status:MembershipStatus.ACTIVE,expiresAt:exp,gracePeriodExpiresAt:grace}});
  } else if(type==="SUBSCRIPTION_PAUSED"){
    await prisma.membership.updateMany({where:{userId:u.id},data:{cancelAt:exp||null}});
  }
  res.json({received:true});
});

// ---------- Discovery, likes, matches, chat ----------
app.get("/api/discover",auth,datingAccess,async(req,res)=>{
  const me=await prisma.user.findUnique({where:{id:uid(req)},include:{profile:true,preference:true,location:true}});if(!me?.profile)return res.status(400).json({error:"Complete your profile first"});
  const [likes,passes,blocks]=await Promise.all([prisma.like.findMany({where:{fromUserId:me.id},select:{toUserId:true}}),prisma.pass.findMany({where:{fromUserId:me.id},select:{toUserId:true}}),prisma.block.findMany({where:{OR:[{blockerId:me.id},{blockedId:me.id}]},select:{blockerId:true,blockedId:true}})]);
  const excluded=new Set([me.id,...likes.map(x=>x.toUserId),...passes.map(x=>x.toUserId)]);blocks.forEach(b=>{excluded.add(b.blockerId);excluded.add(b.blockedId)});
  const candidates=await prisma.user.findMany({where:{status:"ACTIVE",ageEligible:true,id:{notIn:[...excluded]},emailStatus:VerificationStatus.VERIFIED,...(isWebClient(req)?{}:{phoneStatus:VerificationStatus.VERIFIED}),identityVerification:{status:KycStatus.VERIFIED},photoVerification:{status:PhotoVerificationStatus.VERIFIED},profile:{reviewStatus:ProfileReviewStatus.APPROVED}},include:{profile:{include:{photos:{where:{moderationStatus:ModerationStatus.APPROVED},orderBy:{order:"asc"}}},},location:true,lastActiveAt:true},take:250});
  const pref=me.preference||{minAge:18,maxAge:99,maxDistanceKm:50,genderPreference:null,relationshipIntent:null,interests:[]};
  const result=candidates.map(u=>{const p=u.profile!;const age=ageAt(p.birthDate);const dist=me.location&&u.profile&&u.profile?((u as any).location?distanceKm(me.location.latitude,me.location.longitude,(u as any).location.latitude,(u as any).location.longitude):9999):9999;const ageFit=age>=pref.minAge&&age<=pref.maxAge?30:0;const distFit=dist<=pref.maxDistanceKm?25:0;const genderFit=!pref.genderPreference||p.gender===pref.genderPreference?15:0;const intentFit=!pref.relationshipIntent||p.relationshipIntent===pref.relationshipIntent?10:0;const shared=(pref.interests||[]).filter((x:string)=>p.interests.includes(x)).length;const interestFit=Math.min(shared*5,20);const freshness=Math.max(0,10-Math.min(10,Math.floor((Date.now()-u.lastActiveAt.getTime())/86400000)));const score=ageFit+distFit+genderFit+intentFit+interestFit+freshness;return{...p,userId:u.id,age,distanceKm:dist===9999?null:Number(dist.toFixed(1)),score,verified:true,photos:p.photos};}).filter(x=>x.age>=pref.minAge&&x.age<=pref.maxAge&&(!pref.maxDistanceKm||x.distanceKm===null||x.distanceKm<=pref.maxDistanceKm)&&(!pref.genderPreference||x.gender===pref.genderPreference)&&(!pref.relationshipIntent||x.relationshipIntent===pref.relationshipIntent)).sort((a,b)=>b.score-a.score).slice(0,50);
  res.json(result);
});
app.post("/api/discovery/pass/:userId",auth,datingAccess,async(req,res)=>{const to=req.params.userId;if(to===uid(req))return res.status(400).json({error:"Invalid pass"});await prisma.pass.upsert({where:{fromUserId_toUserId:{fromUserId:uid(req),toUserId:to}},create:{fromUserId:uid(req),toUserId:to},update:{}});res.json({passed:true});});
app.post("/api/likes/:userId",auth,datingAccess,async(req,res)=>{const from=uid(req),to=req.params.userId;if(from===to)return res.status(400).json({error:"Invalid like"});if(await prisma.block.findFirst({where:{OR:[{blockerId:from,blockedId:to},{blockerId:to,blockedId:from}]}}))return res.status(403).json({error:"This interaction is unavailable"});await prisma.like.upsert({where:{fromUserId_toUserId:{fromUserId:from,toUserId:to}},create:{fromUserId:from,toUserId:to},update:{}});await prisma.pass.deleteMany({where:{fromUserId:from,toUserId:to}});const reciprocal=await prisma.like.findUnique({where:{fromUserId_toUserId:{fromUserId:to,toUserId:from}}});if(!reciprocal){await notify(to,"LIKE","Someone liked you","You have a new like.",{fromUserId:from});return res.json({matched:false});}const [a,b]=[from,to].sort();const match=await prisma.match.upsert({where:{userAId_userBId:{userAId:a,userBId:b}},create:{userAId:a,userBId:b},update:{}});await notify(to,"MATCH","It's a match","You have a new match.",{matchId:match.id});await notify(from,"MATCH","It's a match","You have a new match.",{matchId:match.id});await audit("MATCH_CREATED","MATCH",match.id,from,undefined,req,{userAId:a,userBId:b});io.to(`user:${from}`).emit("match.created",{matchId:match.id});io.to(`user:${to}`).emit("match.created",{matchId:match.id});res.json({matched:true,matchId:match.id});});
app.get("/api/matches",auth,datingAccess,async(req,res)=>{const id=uid(req);const matches=await prisma.match.findMany({where:{OR:[{userAId:id},{userBId:id}]},include:{userA:{include:{profile:true,photoVerification:true}},userB:{include:{profile:true,photoVerification:true}}},orderBy:{createdAt:"desc"}});res.json(matches.map(m=>({id:m.id,createdAt:m.createdAt,user:m.userAId===id?m.userB:m.userA})));});
app.delete("/api/matches/:matchId",auth,datingAccess,async(req,res)=>{const m=await prisma.match.findFirst({where:{id:req.params.matchId,OR:[{userAId:uid(req)},{userBId:uid(req)}]}});if(!m)return res.status(404).json({error:"Match not found"});await prisma.match.delete({where:{id:m.id}});await audit("MATCH_UNMATCHED","MATCH",m.id,uid(req),undefined,req);res.json({unmatched:true});});
app.get("/api/matches/:matchId/messages",auth,datingAccess,async(req,res)=>{const m=await prisma.match.findFirst({where:{id:req.params.matchId,OR:[{userAId:uid(req)},{userBId:uid(req)}]}});if(!m)return res.status(404).json({error:"Match not found"});const messages=await prisma.message.findMany({where:{matchId:m.id},orderBy:{createdAt:"desc"},take:100});await prisma.message.updateMany({where:{matchId:m.id,senderId:{not:uid(req)},status:{not:MessageStatus.READ}},data:{status:MessageStatus.READ}});res.json(messages.reverse());});
app.post("/api/matches/:matchId/messages",auth,datingAccess,messageLimiter,async(req,res)=>{const p=z.object({body:z.string().trim().min(1).max(2000)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid message"});const m=await prisma.match.findFirst({where:{id:req.params.matchId,OR:[{userAId:uid(req)},{userBId:uid(req)}]}});if(!m)return res.status(404).json({error:"Match not found"});const target=m.userAId===uid(req)?m.userBId:m.userAId;if(await prisma.block.findFirst({where:{OR:[{blockerId:uid(req),blockedId:target},{blockerId:target,blockedId:uid(req)}]}}))return res.status(403).json({error:"This conversation is unavailable"});const mod=await moderationText(p.data.body);if(mod.configured&&mod.flagged){await audit("MESSAGE_BLOCKED_MODERATION","MESSAGE",undefined,uid(req),undefined,req,{categories:mod.categories});return res.status(400).json({error:"This message could not be sent."});}const msg=await prisma.message.create({data:{matchId:m.id,senderId:uid(req),body:p.data.body,status:MessageStatus.SENT}});await notify(target,"MESSAGE","New message",p.data.body.slice(0,120),{matchId:m.id,messageId:msg.id});io.to(`user:${target}`).emit("message.created",msg);io.to(`match:${m.id}`).emit("message.created",msg);res.status(201).json(msg);});

// ---------- Notifications / Security / Privacy ----------
app.post("/api/push-tokens",auth,async(req,res)=>{const p=z.object({token:z.string().min(10).max(500),platform:z.enum(["ios","android","web"]),deviceId:z.string().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid push token"});res.json(await prisma.pushToken.upsert({where:{token:p.data.token},create:{userId:uid(req),token:p.data.token,platform:p.data.platform,deviceId:p.data.deviceId},update:{userId:uid(req),platform:p.data.platform,deviceId:p.data.deviceId,lastSeenAt:new Date()}}));});
app.get("/api/notifications",auth,async(req,res)=>res.json(await prisma.notification.findMany({where:{userId:uid(req)},orderBy:{createdAt:"desc"},take:50})));app.post("/api/notifications/:id/read",auth,async(req,res)=>{await prisma.notification.updateMany({where:{id:req.params.id,userId:uid(req)},data:{readAt:new Date()}});res.json({read:true});});
app.get("/api/notification-preferences",auth,async(req,res)=>res.json(await prisma.notificationPreference.upsert({where:{userId:uid(req)},create:{userId:uid(req)},update:{}})));
app.put("/api/notification-preferences",auth,async(req,res)=>{const p=z.object({pushMessages:z.boolean(),pushMatches:z.boolean(),pushLikes:z.boolean(),pushVerification:z.boolean(),pushMembership:z.boolean(),pushSafety:z.boolean(),emailAccount:z.boolean(),emailMarketing:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid notification preferences"});res.json(await prisma.notificationPreference.upsert({where:{userId:uid(req)},create:{userId:uid(req),...p.data},update:p.data}));});
app.get("/api/security/sessions",auth,async(req,res)=>{const sessions=await prisma.session.findMany({where:{userId:uid(req),revokedAt:null,expiresAt:{gt:new Date()}},orderBy:{lastUsedAt:"desc"},select:{id:true,deviceId:true,userAgent:true,createdAt:true,lastUsedAt:true,expiresAt:true}});res.json(sessions.map(s=>({...s,current:false})));});
app.delete("/api/security/sessions/:id",auth,async(req,res)=>{const r=await prisma.session.updateMany({where:{id:req.params.id,userId:uid(req),revokedAt:null},data:{revokedAt:new Date()}});if(!r.count)return res.status(404).json({error:"Session not found"});res.json({revoked:true});});
app.get("/api/privacy/export", auth, async (req, res) => {
  const id = uid(req);
  const u = await prisma.user.findUnique({ where: { id }, include: { profile: { include: { photos: true } }, preference: true, location: true, membership: true, identityVerification: true, photoVerification: true, consentRecords: true, notifications: true, notificationPreference: true, pushTokens: true, likesSent: true, passesSent: true, blocksSent: true, reportsMade: true, sessions: true } });
  if (!u) return res.status(404).json({ error: "Account not found" });
  const matches = await prisma.match.findMany({ where: { OR: [{ userAId: id }, { userBId: id }] }, include: { messages: true } });
  res.json({
    account: { id: u.id, email: u.email, phoneNumber: u.phoneNumber, emailStatus: u.emailStatus, phoneStatus: u.phoneStatus, createdAt: u.createdAt },
    profile: u.profile, preferences: u.preference, location: u.location, membership: u.membership,
    identityVerification: { status: u.identityVerification?.status, provider: u.identityVerification?.provider, documentType: u.identityVerification?.documentType, submittedAt: u.identityVerification?.submittedAt, verifiedAt: u.identityVerification?.verifiedAt, rejectedAt: u.identityVerification?.rejectedAt, rejectionReason: u.identityVerification?.rejectionReason },
    photoVerification: u.photoVerification, consents: u.consentRecords, notifications: u.notifications, notificationPreference: u.notificationPreference,
    pushTokens: u.pushTokens.map(x => ({ platform: x.platform, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt })), likesSent: u.likesSent, passesSent: u.passesSent, blocksSent: u.blocksSent, reportsMade: u.reportsMade,
    sessions: u.sessions.map(x => ({ createdAt: x.createdAt, lastUsedAt: x.lastUsedAt, expiresAt: x.expiresAt, revokedAt: x.revokedAt })), matches
  });
});
app.post("/api/consents",auth,async(req,res)=>{const p=z.object({type:z.enum(["TERMS","PRIVACY","MARKETING"]),version:z.string().min(1).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid consent"});res.json(await prisma.consent.upsert({where:{userId_type_version:{userId:uid(req),type:p.data.type,version:p.data.version}},create:{userId:uid(req),type:p.data.type,version:p.data.version,ipHash:hash(reqIp(req))},update:{}}));});

async function deleteUserAccount(userId:string){
  const media=await prisma.media.findMany({where:{userId},select:{key:true}});for(const m of media)await deleteMediaObject(m.key);
  await prisma.user.delete({where:{id:userId}});
}
app.delete("/api/account",auth,async(req,res)=>{const p=z.object({password:z.string().min(1),reason:z.string().max(500).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Password required"});const u=await prisma.user.findUnique({where:{id:uid(req)},include:{membership:true}});if(!u||!(await bcrypt.compare(p.data.password,u.passwordHash)))return res.status(401).json({error:"Incorrect password"});await audit("ACCOUNT_DELETION_REQUESTED","USER",u.id,u.id,undefined,req,{reason:p.data.reason,activeMembership:Boolean(u.membership?.status===MembershipStatus.ACTIVE)});await deleteUserAccount(u.id);res.json({deleted:true});});
app.post("/api/account/deletion-request/start",deletionLimiter,async(req,res)=>{const p=z.object({email:z.string().email(),reason:z.string().max(500).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Valid email required"});const email=p.data.email.toLowerCase().trim();const user=await prisma.user.findUnique({where:{email},select:{id:true}});const code=randomCode();const expires=new Date(Date.now()+15*60*1000);const request=await prisma.accountDeletionRequest.create({data:{email,userId:user?.id,reason:p.data.reason,verificationCodeHash:hashDeletionCode(code),verificationExpiresAt:expires}});if(user){await sendTransactionalEmail(email,"Bundle account deletion confirmation",`<p>We received a request to delete your Bundle account.</p><p>Enter this confirmation code on the deletion page:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p><p>This code expires in 15 minutes. If you did not request this, you can ignore this email.</p>`).catch(async()=>{await prisma.accountDeletionRequest.delete({where:{id:request.id}});throw new Error("Unable to send deletion confirmation email");});}res.json({requested:true,requestId:request.id,message:"If a Bundle account exists for that address, we sent a confirmation code. Check your email to continue."});});
app.post("/api/account/deletion-request/confirm",deletionLimiter,async(req,res)=>{const p=z.object({requestId:z.string().min(1),code:z.string().regex(/^\d{6}$/)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Valid confirmation code required"});const r=await prisma.accountDeletionRequest.findUnique({where:{id:p.data.requestId}});if(!r||r.status!==DeletionRequestStatus.PENDING||!r.verificationCodeHash||!r.verificationExpiresAt||r.verificationExpiresAt<=new Date()||r.verificationCodeHash!==hashDeletionCode(p.data.code))return res.status(400).json({error:"Invalid or expired confirmation code"});await prisma.accountDeletionRequest.update({where:{id:r.id},data:{verifiedAt:new Date(),verificationCodeHash:null,verificationExpiresAt:null}});res.json({requested:true,message:"Your deletion request has been verified and sent to Bundle for processing. If you are subscribed, cancel store billing separately to prevent renewal."});});

app.post("/api/blocks/:userId",auth,datingAccess,async(req,res)=>{const other=req.params.userId;if(other===uid(req))return res.status(400).json({error:"Invalid block"});await prisma.block.upsert({where:{blockerId_blockedId:{blockerId:uid(req),blockedId:other}},create:{blockerId:uid(req),blockedId:other},update:{}});res.json({blocked:true});});
app.delete("/api/blocks/:userId",auth,async(req,res)=>{await prisma.block.deleteMany({where:{blockerId:uid(req),blockedId:req.params.userId}});res.json({blocked:false});});
app.get("/api/blocks",auth,async(req,res)=>res.json(await prisma.block.findMany({where:{blockerId:uid(req)},include:{blocked:{include:{profile:true}}},orderBy:{createdAt:"desc"}})));
app.post("/api/reports/:userId",auth,datingAccess,async(req,res)=>{const p=z.object({reason:z.enum(["FAKE_PROFILE","SCAM","HARASSMENT","INAPPROPRIATE_CONTENT","THREATS","SPAM","UNDERAGE_CONCERN","OTHER"]),details:z.string().max(2000).optional(),matchId:z.string().optional(),messageId:z.string().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid report"});if(uid(req)===req.params.userId)return res.status(400).json({error:"Invalid report target"});const r=await prisma.report.create({data:{reporterId:uid(req),reportedUserId:req.params.userId,reason:p.data.reason,details:p.data.details,matchId:p.data.matchId,messageId:p.data.messageId}});await audit("USER_REPORTED","REPORT",r.id,uid(req),undefined,req,{reason:p.data.reason});await notify(req.params.userId,"SAFETY_REPORT","Safety report received","Bundle has received a safety report involving your account.",undefined,true).catch(()=>undefined);res.status(201).json({id:r.id,status:r.status});});

// ---------- Admin / Trust & Safety ----------
app.get("/api/admin/me",auth,supportStaff,async(req,res)=>res.json({userId:uid(req),role:(req as any).staffRole}));
app.get("/api/admin/dashboard",auth,supportStaff,async(req,res)=>{const [pendingProfiles,pendingKyc,pendingPhotos,pendingMedia,openReports,users,activeMembers]=await Promise.all([prisma.profile.count({where:{reviewStatus:ProfileReviewStatus.PENDING}}),prisma.identityVerification.count({where:{status:KycStatus.PENDING}}),prisma.photoVerification.count({where:{status:PhotoVerificationStatus.PENDING}}),prisma.media.count({where:{moderationStatus:ModerationStatus.PENDING}}),prisma.report.count({where:{status:{in:[ReportStatus.OPEN,ReportStatus.IN_REVIEW]}}}),prisma.user.count(),prisma.membership.count({where:{status:MembershipStatus.ACTIVE,expiresAt:{gt:new Date()}}})]);res.json({pendingProfiles,pendingKyc,pendingPhotos,pendingMedia,openReports,users,activeMembers});});
app.get("/api/admin/profiles",auth,supportStaff,async(req,res)=>res.json(await prisma.profile.findMany({where:{reviewStatus:ProfileReviewStatus.PENDING},include:{user:true,photos:true},orderBy:{createdAt:"asc"},take:100})));
app.post("/api/admin/profile/:userId/review",auth,moderationStaff,async(req,res)=>{const p=z.object({decision:z.enum(["APPROVED","REJECTED"]),reason:z.string().max(1000).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid review"});if(p.data.decision==="APPROVED"){const user=await prisma.user.findUnique({where:{id:req.params.userId},include:{identityVerification:true,photoVerification:true,profile:{include:{photos:{where:{moderationStatus:ModerationStatus.APPROVED}}}}}});if(!user||user.identityVerification?.status!==KycStatus.VERIFIED||user.photoVerification?.status!==PhotoVerificationStatus.VERIFIED||!user.profile?.photos.length)return res.status(400).json({error:"Identity, photo verification and at least one approved profile photo are required before profile approval."});}const profile=await prisma.profile.update({where:{userId:req.params.userId},data:{reviewStatus:p.data.decision as any,reviewReason:p.data.reason||null}});await notify(req.params.userId,p.data.decision==="APPROVED"?"PROFILE_APPROVED":"PROFILE_REJECTED",p.data.decision==="APPROVED"?"Profile approved":"Profile needs changes",p.data.reason||"Bundle has reviewed your profile.",undefined,true);await audit("PROFILE_REVIEWED","PROFILE",profile.id,req.params.userId,uid(req),req,{decision:p.data.decision});if(p.data.decision==="APPROVED")await syncRevenueCatMembership(req.params.userId);res.json(profile);});
app.get("/api/admin/kyc",auth,moderationStaff,async(req,res)=>res.json(await prisma.identityVerification.findMany({where:{status:KycStatus.PENDING},select:{id:true,userId:true,status:true,provider:true,providerRef:true,documentType:true,submittedAt:true},orderBy:{submittedAt:"asc"},take:100})));
app.post("/api/admin/kyc/:userId/review",auth,moderationStaff,async(req,res)=>{const p=z.object({decision:z.enum(["VERIFIED","REJECTED"]),reason:z.string().max(1000).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid decision"});const v=await prisma.identityVerification.update({where:{userId:req.params.userId},data:{status:p.data.decision as any,verifiedAt:p.data.decision==="VERIFIED"?new Date():null,rejectedAt:p.data.decision==="REJECTED"?new Date():null,rejectionReason:p.data.decision==="REJECTED"?p.data.reason||"Manual review did not approve this verification.":null}});await notify(req.params.userId,p.data.decision==="VERIFIED"?"VERIFY_IDENTITY":"VERIFY_IDENTITY",p.data.decision==="VERIFIED"?"Identity verified":"Identity verification needs attention",p.data.decision==="VERIFIED"?"Your Bundle identity verification is complete.":p.data.reason||"Please try verification again.",undefined,true);await audit("KYC_MANUAL_REVIEW","IDENTITY_VERIFICATION",v.id,req.params.userId,uid(req),req,{decision:p.data.decision});res.json(v);});
app.get("/api/admin/photos",auth,moderationStaff,async(req,res)=>res.json(await prisma.photoVerification.findMany({where:{status:PhotoVerificationStatus.PENDING},include:{user:{include:{profile:true}}},take:100})));
app.post("/api/admin/photo/:userId/verify",auth,moderationStaff,async(req,res)=>{const p=z.object({decision:z.enum(["VERIFIED","REJECTED"]),reason:z.string().max(500).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid decision"});const v=await prisma.photoVerification.update({where:{userId:req.params.userId},data:{status:p.data.decision as any,verifiedAt:p.data.decision==="VERIFIED"?new Date():null,rejectionReason:p.data.decision==="REJECTED"?p.data.reason||"Photo verification did not pass review.":null}});await notify(req.params.userId,"PHOTO_VERIFIED",p.data.decision==="VERIFIED"?"Photo verification complete":"Photos need changes",p.data.reason||"Bundle has reviewed your photos.",undefined,true);if(p.data.decision==="VERIFIED")await syncRevenueCatMembership(req.params.userId);res.json(v);});
app.get("/api/admin/media",auth,moderationStaff,async(req,res)=>{const rows=await prisma.media.findMany({where:{moderationStatus:ModerationStatus.PENDING},include:{user:{include:{profile:true}}},orderBy:{createdAt:"asc"},take:100});res.json(await Promise.all(rows.map(async r=>({...r,url:await mediaReadUrl(r.key)}))));});
app.post("/api/admin/media/:id/moderate",auth,moderationStaff,async(req,res)=>{const p=z.object({decision:z.enum(["APPROVED","REJECTED"]),reason:z.string().max(500).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid moderation decision"});const row=await prisma.media.findUnique({where:{id:req.params.id}});if(!row)return res.status(404).json({error:"Media not found"});const updated=await prisma.media.update({where:{id:row.id},data:{moderationStatus:p.data.decision as any,moderationReason:p.data.reason||null}});await audit("MEDIA_MODERATED","MEDIA",row.id,row.userId,uid(req),req,{decision:p.data.decision});res.json(updated);});
app.get("/api/admin/reports",auth,supportStaff,async(req,res)=>res.json(await prisma.report.findMany({where:{status:{in:[ReportStatus.OPEN,ReportStatus.IN_REVIEW]}},include:{reporter:{include:{profile:true}},reportedUser:{include:{profile:true}}},orderBy:{createdAt:"asc"},take:100})));
app.post("/api/admin/report/:id/resolve",auth,moderationStaff,async(req,res)=>{const p=z.object({status:z.enum(["RESOLVED","DISMISSED"]),note:z.string().max(1000).optional(),suspendUser:z.boolean().default(false)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid moderation action"});const r=await prisma.report.findUnique({where:{id:req.params.id}});if(!r)return res.status(404).json({error:"Report not found"});await prisma.report.update({where:{id:r.id},data:{status:p.data.status as any,details:[r.details,p.data.note].filter(Boolean).join("\n\n")||null}});if(p.data.suspendUser)await prisma.user.update({where:{id:r.reportedUserId},data:{status:"SUSPENDED"}});await audit("REPORT_RESOLVED","REPORT",r.id,r.reportedUserId,uid(req),req,{status:p.data.status,suspendUser:p.data.suspendUser});res.json({resolved:true});});
app.get("/api/admin/deletion-requests",auth,supportStaff,async(req,res)=>res.json(await prisma.accountDeletionRequest.findMany({where:{status:DeletionRequestStatus.PENDING,verifiedAt:{not:null}},orderBy:{createdAt:"asc"},take:100})));
app.post("/api/admin/deletion-requests/:id/process",auth,supportStaff,async(req,res)=>{const p=z.object({decision:z.enum(["COMPLETED","REJECTED"])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid decision"});const r=await prisma.accountDeletionRequest.findUnique({where:{id:req.params.id}});if(!r)return res.status(404).json({error:"Deletion request not found"});if(p.data.decision==="COMPLETED"&&r.userId){await deleteUserAccount(r.userId);}await prisma.accountDeletionRequest.update({where:{id:r.id},data:{status:p.data.decision as DeletionRequestStatus,processedAt:new Date()}});await audit("DELETION_REQUEST_PROCESSED","DELETION_REQUEST",r.id,r.userId||undefined,uid(req),req,{decision:p.data.decision});res.json({processed:true});});
app.post("/api/admin/user/:userId/suspend",auth,moderationStaff,async(req,res)=>{const p=z.object({suspended:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid status"});const u=await prisma.user.update({where:{id:req.params.userId},data:{status:p.data.suspended?"SUSPENDED":"ACTIVE"}});if(p.data.suspended)await prisma.session.updateMany({where:{userId:u.id,revokedAt:null},data:{revokedAt:new Date()}});await audit(p.data.suspended?"USER_SUSPENDED":"USER_REINSTATED","USER",u.id,u.id,uid(req),req);res.json({status:u.status});});

// ---------- Realtime ----------
io.use(async(socket,next)=>{try{const token=String(socket.handshake.auth?.token||"");const p:any=jwt.verify(token,ACCESS_SECRET);if(p.typ!=="access")throw new Error("invalid");const user=await prisma.user.findUnique({where:{id:p.sub},select:{status:true}});if(!user||user.status!=="ACTIVE")throw new Error("invalid");(socket as any).userId=p.sub;next();}catch{next(new Error("Unauthorized"));}});
io.on("connection",socket=>{const userId=(socket as any).userId as string;socket.join(`user:${userId}`);socket.on("joinMatch",async(matchId:string)=>{const m=await prisma.match.findFirst({where:{id:matchId,OR:[{userAId:userId},{userBId:userId}]}});if(m)socket.join(`match:${matchId}`);});socket.on("leaveMatch",(matchId:string)=>socket.leave(`match:${matchId}`));socket.on("typing",async(payload:any)=>{const matchId=String(payload?.matchId||"");const m=await prisma.match.findFirst({where:{id:matchId,OR:[{userAId:userId},{userBId:userId}]}});if(!m)return;io.to(`match:${matchId}`).emit("typing",{userId,isTyping:Boolean(payload?.isTyping)});});});

app.use((_,res)=>res.status(404).json({error:"Route not found"}));
app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{console.error(err);res.status(500).json({error:isProd?"Internal server error":err?.message||"Internal server error"});});

process.on("SIGINT",async()=>{await prisma.$disconnect();httpServer.close();process.exit(0)});process.on("SIGTERM",async()=>{await prisma.$disconnect();httpServer.close();process.exit(0)});
httpServer.listen(PORT,()=>console.log(`Bundle API + realtime server running on http://localhost:${PORT}`));
