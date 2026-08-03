import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { JwksService } from "./jwks.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";

@Module({ controllers: [AuthController], providers: [JwksService, SupabaseAuthGuard], exports: [JwksService, SupabaseAuthGuard] })
export class AuthModule {}
