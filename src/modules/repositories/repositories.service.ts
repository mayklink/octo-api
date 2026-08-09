import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CredentialKind, Prisma, RepositoryStatus } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AzureDevOpsAdapter } from "../azure-devops/azure-devops.adapter";
import { CredentialsService } from "../credentials/credentials.service";
import type { CreateRepositoryDto, DiscoverAzureRepositoriesDto, UpdateRepositoryDto } from "./repositories.dto";

@Injectable()
export class RepositoriesService {
  constructor(private readonly prisma: PrismaService, private readonly credentials: CredentialsService, private readonly azure: AzureDevOpsAdapter, private readonly config: ConfigService) {}

  list(organizationId: string) { return this.prisma.repository.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: publicRepositorySelect }); }

  async create(organizationId: string, dto: CreateRepositoryDto) {
    try {
      return await this.prisma.repository.create({ data: { organizationId, ...dto, settings: { create: { prompt: defaultPrompt, model: this.config.getOrThrow("review.defaultModel") } } }, select: publicRepositorySelect });
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Repository is already registered"); throw error; }
  }

  async update(organizationId: string, id: string, dto: UpdateRepositoryDto) {
    await this.get(organizationId, id);
    return this.prisma.repository.update({ where: { id }, data: { name: dto.name, status: dto.enabled === undefined ? undefined : dto.enabled ? RepositoryStatus.active : RepositoryStatus.disabled }, select: publicRepositorySelect });
  }

  async configureAzure(organizationId: string, id: string, pat?: string) {
    const repository = await this.get(organizationId, id);
    const effectivePat = pat ?? (await this.loadOrgConnection(organizationId))?.pat;
    if (!effectivePat) throw new NotFoundException("No Personal Access Token was provided and no Azure DevOps connection is saved for this organization");
    const validated = await this.azure.validateConnection(repository, effectivePat);
    await this.credentials.store(organizationId, id, CredentialKind.azure_devops_pat, effectivePat);
    const { secret, hash } = this.credentials.generateWebhookSecret();
    const updated = await this.prisma.repository.update({ where: { id }, data: { name: validated.name, cloneUrl: validated.cloneUrl, status: "active", webhookSecretHash: hash, webhookSecretVersion: { increment: 1 } }, select: publicRepositorySelect });
    return { ...updated, webhookUrl: this.webhookUrl(id, secret) };
  }

  async discoverAzureRepositories(organizationId: string, dto: DiscoverAzureRepositoriesDto) {
    const connection = dto.azureOrganization && dto.pat ? { azureOrganization: dto.azureOrganization, pat: dto.pat } : await this.loadOrgConnection(organizationId);
    if (!connection) throw new NotFoundException("Inform an Azure organization and PAT, or connect one for this organization first");
    if (dto.azureOrganization && dto.pat) await this.credentials.store(organizationId, null, CredentialKind.azure_devops_pat, connection);
    return this.azure.listRepositories(connection.azureOrganization, connection.pat);
  }

  async getAzureConnection(organizationId: string) {
    const connection = await this.loadOrgConnection(organizationId);
    return { connected: !!connection, azureOrganization: connection?.azureOrganization ?? null };
  }

  private async loadOrgConnection(organizationId: string): Promise<{ azureOrganization: string; pat: string } | null> {
    try { return (await this.credentials.load(organizationId, null, CredentialKind.azure_devops_pat)) as { azureOrganization: string; pat: string }; }
    catch (error) { if (error instanceof NotFoundException) return null; throw error; }
  }

  async listPullRequests(organizationId: string, id: string) {
    const repository = await this.get(organizationId, id);
    if (repository.status !== RepositoryStatus.active) throw new ConflictException("Repository integration is not active");
    const pat = (await this.credentials.load(organizationId, id, CredentialKind.azure_devops_pat)) as string;
    return this.azure.listPullRequests(repository, pat);
  }

  async rotateWebhook(organizationId: string, id: string) {
    await this.get(organizationId, id);
    const { secret, hash } = this.credentials.generateWebhookSecret();
    await this.prisma.repository.update({ where: { id }, data: { webhookSecretHash: hash, webhookSecretVersion: { increment: 1 } } });
    return { webhookUrl: this.webhookUrl(id, secret) };
  }

  async get(organizationId: string, id: string) {
    const repository = await this.prisma.repository.findFirst({ where: { id, organizationId } });
    if (!repository) throw new NotFoundException("Repository not found");
    return repository;
  }

  private webhookUrl(id: string, secret: string) { const url = new URL("/webhooks/azure-devops", this.config.getOrThrow<string>("app.publicUrl")); url.searchParams.set("repository", id); url.searchParams.set("token", secret); return url.toString(); }
}

const publicRepositorySelect = { id: true, organizationId: true, name: true, provider: true, azureOrganization: true, azureProjectId: true, azureRepositoryId: true, cloneUrl: true, status: true, webhookSecretVersion: true, createdAt: true, updatedAt: true } as const;
const defaultPrompt = "Revise as alterações do pull request procurando bugs, regressões, vulnerabilidades e violações de contrato. Produza findings objetivos, acionáveis e ancorados no código alterado.";
