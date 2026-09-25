import "dotenv/config";
const required=["DATABASE_URL","JWT_SECRET","REFRESH_TOKEN_SECRET","DELETION_REQUEST_SECRET"];
const optional=["TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","TWILIO_VERIFY_SERVICE_SID","PERSONA_API_KEY","PERSONA_ENVIRONMENT_ID","PERSONA_INQUIRY_TEMPLATE_ID","PERSONA_WEBHOOK_SECRET","REVENUECAT_API_KEY","REVENUECAT_WEBHOOK_AUTH","REVENUECAT_ENTITLEMENT_ID","AWS_S3_BUCKET"];
for(const k of required) if(!process.env[k]) { console.error(`MISSING required env: ${k}`); process.exitCode=1; }
for(const k of optional) console.log(`${k}: ${process.env[k] ? "configured" : "NOT CONFIGURED"}`);
console.log("Bundle production configuration self-check complete.");
