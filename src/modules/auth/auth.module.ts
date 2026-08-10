import { forwardRef, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { JwksService } from "./jwks.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { SupabaseAdminService } from "./supabase-admin.service";
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({ imports: [forwardRef(() => OrganizationsModule)], controllers: [AuthController], providers: [JwksService, SupabaseAuthGuard, SupabaseAdminService], exports: [JwksService, SupabaseAuthGuard, SupabaseAdminService] })
export class AuthModule {}
