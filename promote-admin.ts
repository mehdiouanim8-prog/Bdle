import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
const prisma=new PrismaClient();
const email=process.argv[2]?.toLowerCase().trim();
if(!email){console.error("Usage: npm run admin:promote -- user@example.com");process.exit(1)}
const user=await prisma.user.update({where:{email},data:{role:UserRole.ADMIN},select:{id:true,email:true,role:true}}).catch(()=>null);
if(!user){console.error("User not found");process.exit(1)}
console.log(`Promoted ${user.email} to ${user.role}`);await prisma.$disconnect();
