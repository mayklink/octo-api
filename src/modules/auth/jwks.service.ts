import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

@Injectable()
export class JwksService {
  private readonly jwks;
  constructor(private readonly config: ConfigService) {
    this.jwks = createRemoteJWKSet(new URL(config.getOrThrow<string>("auth.jwksUrl")), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
  }

  async verify(token: string): Promise<JWTPayload> {
    const result = await jwtVerify(token, this.jwks, {
      issuer: this.config.getOrThrow<string>("auth.issuer"),
      audience: this.config.getOrThrow<string>("auth.audience"),
      algorithms: ["RS256", "ES256", "EdDSA"],
    });
    return result.payload;
  }
}
