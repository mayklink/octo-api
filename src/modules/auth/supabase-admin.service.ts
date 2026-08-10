import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class SupabaseAdminService {
  private readonly url: string;
  private readonly serviceRoleKey: string;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>("auth.supabaseUrl").replace(/\/$/, "");
    this.serviceRoleKey = config.getOrThrow<string>("auth.serviceRoleKey");
  }

  async inviteUserByEmail(email: string): Promise<{ id?: string }> {
    const response = await fetch(`${this.url}/auth/v1/invite`, {
      method: "POST",
      headers: { apikey: this.serviceRoleKey, Authorization: `Bearer ${this.serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new InternalServerErrorException(`Supabase invite failed (${response.status})${body ? `: ${body}` : ""}`);
    }
    const body = await response.json() as { id?: string };
    return { id: body.id };
  }
}
