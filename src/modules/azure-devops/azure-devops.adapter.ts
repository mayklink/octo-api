import { BadGatewayException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ReviewFinding } from "@prisma/client";
import type { AzureContext, AzureDiscoveredRepository, AzurePullRequest, AzureRepositoryConfig } from "./azure-devops.types";

const AZURE_PROJECT_CONCURRENCY = 5;
type AzureProject = { id: string; name?: unknown };
type AzureRepositoryResponse = { id: string; name?: unknown; remoteUrl: string };

@Injectable()
export class AzureDevOpsAdapter {
  private readonly apiVersion: string;
  constructor(config: ConfigService) { this.apiVersion = config.get("azure.apiVersion", "7.1"); }

  async validateConnection(config: AzureRepositoryConfig, pat: string): Promise<{ name: string; cloneUrl: string }> {
    const repository = await this.request<unknown>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}`);
    if (!isRecord(repository) || typeof repository.id !== "string" || typeof repository.remoteUrl !== "string") throw new BadGatewayException("Azure DevOps returned an invalid repository");
    return { name: String(repository.name), cloneUrl: sanitizeCloneUrl(String(repository.remoteUrl)) };
  }

  async getPullRequest(config: AzureRepositoryConfig, pat: string, pullRequestId: string): Promise<AzurePullRequest> {
    const value = await this.request<unknown>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}`);
    if (!isRecord(value)) throw new BadGatewayException("Azure DevOps returned an invalid pull request");
    const sourceCommit = String(isRecord(value.lastMergeSourceCommit) ? value.lastMergeSourceCommit.commitId ?? "" : "");
    const targetCommit = String(isRecord(value.lastMergeTargetCommit) ? value.lastMergeTargetCommit.commitId ?? "" : "");
    if (!/^[a-f0-9]{40,64}$/i.test(sourceCommit) || !/^[a-f0-9]{40,64}$/i.test(targetCommit)) throw new BadGatewayException("Azure DevOps did not return complete source and target commits");
    return { id: String(value.pullRequestId), title: String(value.title ?? "Pull request"), status: String(value.status ?? "unknown"), sourceBranch: String(value.sourceRefName), targetBranch: String(value.targetRefName), sourceCommit, targetCommit, raw: value };
  }

  async getReviewContext(config: AzureRepositoryConfig, pat: string, pullRequestId: string): Promise<AzureContext> {
    const base = `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}`;
    const [pullRequest, workItemRefs, threads] = await Promise.all([
      this.request<Record<string, unknown>>(config, pat, base),
      this.request<{ value?: unknown[] }>(config, pat, `${base}/workitems`),
      this.request<{ value?: unknown[] }>(config, pat, `${base}/threads`),
    ]);
    const workItemIds = (workItemRefs.value ?? []).flatMap((value) => {
      if (!isRecord(value)) return [];
      const id = Number(value.id);
      return Number.isSafeInteger(id) && id > 0 ? [id] : [];
    }).slice(0, 200);
    const workItems = workItemIds.length
      ? await this.request<{ value?: unknown[] }>(config, pat, "/_apis/wit/workitemsbatch", {
          method: "POST",
          body: {
            ids: workItemIds,
            fields: ["System.Id", "System.WorkItemType", "System.Title", "System.State", "System.Description", "Microsoft.VSTS.Common.AcceptanceCriteria", "System.Tags"],
            errorPolicy: "Omit",
          },
        })
      : { value: [] };
    return { pullRequest, workItems: workItems.value ?? [], threads: threads.value ?? [] };
  }

  async listRepositories(organization: string, pat: string): Promise<AzureDiscoveredRepository[]> {
    const projects = await this.requestOrg<{ value?: unknown[] }>(organization, pat, "/_apis/projects?$top=1000");
    const projectList = (projects.value ?? []).flatMap((project): AzureProject[] => isRecord(project) && typeof project.id === "string" ? [{ id: project.id, name: project.name }] : []).slice(0, 200);
    const repositoriesByProject = await mapWithConcurrency(projectList, AZURE_PROJECT_CONCURRENCY, async (project) => {
      try {
        const repos = await this.requestOrg<{ value?: unknown[] }>(organization, pat, `/${encodeURIComponent(project.id)}/_apis/git/repositories`);
        return (repos.value ?? []).flatMap((repo): AzureDiscoveredRepository[] => {
          if (!isAzureRepository(repo)) return [];
          try {
            return [{ projectId: project.id, projectName: String(project.name ?? project.id), repositoryId: repo.id, repositoryName: String(repo.name ?? repo.id), cloneUrl: sanitizeCloneUrl(repo.remoteUrl) }];
          } catch { return []; }
        });
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        if (error instanceof BadGatewayException) return [];
        throw error;
      }
    });
    return repositoriesByProject.flat();
  }

  async listPullRequests(config: AzureRepositoryConfig, pat: string): Promise<AzurePullRequest[]> {
    const result = await this.request<{ value?: unknown[] }>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullrequests?searchCriteria.status=active&$top=100`);
    return (result.value ?? []).flatMap((value): AzurePullRequest[] => {
      if (!isRecord(value) || value.pullRequestId === undefined) return [];
      return [{
        id: String(value.pullRequestId),
        title: String(value.title ?? "Pull request"),
        status: String(value.status ?? "unknown"),
        sourceBranch: String(value.sourceRefName ?? ""),
        targetBranch: String(value.targetRefName ?? ""),
        sourceCommit: String(isRecord(value.lastMergeSourceCommit) ? value.lastMergeSourceCommit.commitId ?? "" : ""),
        targetCommit: String(isRecord(value.lastMergeTargetCommit) ? value.lastMergeTargetCommit.commitId ?? "" : ""),
        raw: value,
      }];
    });
  }

  async findPublication(config: AzureRepositoryConfig, pat: string, pullRequestId: string, dedupKey: string): Promise<string | undefined> {
    const result = await this.request<{ value?: unknown[] }>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/threads`);
    const marker = publicationMarker(dedupKey);
    for (const thread of result.value ?? []) {
      if (!isRecord(thread) || !Array.isArray(thread.comments)) continue;
      const found = thread.comments.some((comment) => isRecord(comment) && typeof comment.content === "string" && comment.content.includes(marker));
      if (found && thread.id !== undefined) return String(thread.id);
    }
    return undefined;
  }

  async publishFinding(config: AzureRepositoryConfig, pat: string, pullRequestId: string, finding: ReviewFinding, dedupKey: string): Promise<string> {
    const content = [`**${finding.severity.toUpperCase()}: ${finding.title}**`, finding.description, finding.suggestion ? `\nSugestão:\n${finding.suggestion}` : "", publicationMarker(dedupKey)].filter(Boolean).join("\n\n");
    const body: Record<string, unknown> = { comments: [{ parentCommentId: 0, content, commentType: 1 }], status: 1 };
    if (finding.line) body.threadContext = { filePath: finding.filePath.startsWith("/") ? finding.filePath : `/${finding.filePath}`, rightFileStart: { line: finding.line, offset: 1 }, rightFileEnd: { line: finding.line, offset: 1 } };
    const created = await this.request<unknown>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/threads`, { method: "POST", body });
    if (!isRecord(created) || created.id === undefined) throw new BadGatewayException("Azure DevOps returned an invalid thread");
    return String(created.id);
  }

  async publishSummary(config: AzureRepositoryConfig, pat: string, pullRequestId: string, content: string, dedupKey: string): Promise<string> {
    const created = await this.request<unknown>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/threads`, {
      method: "POST",
      body: { comments: [{ parentCommentId: 0, content: `${content}\n\n${publicationMarker(dedupKey)}`, commentType: 1 }], status: 1 },
    });
    if (!isRecord(created) || created.id === undefined) throw new BadGatewayException("Azure DevOps returned an invalid thread");
    return String(created.id);
  }

  async updateThread(config: AzureRepositoryConfig, pat: string, pullRequestId: string, threadId: string, status: number): Promise<void> {
    await this.request(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/threads/${encodeURIComponent(threadId)}`, { method: "PATCH", body: { status } });
  }

  async publishStatus(config: AzureRepositoryConfig, pat: string, pullRequestId: string, state: "pending" | "succeeded" | "failed" | "error", description: string, targetUrl?: string): Promise<void> {
    await this.request(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/statuses`, {
      method: "POST", body: { state, description: description.slice(0, 256), context: { genre: "octob", name: "review" }, ...(targetUrl ? { targetUrl } : {}) },
    });
  }

  private async request<T>(config: AzureRepositoryConfig, pat: string, path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const organization = encodeURIComponent(config.azureOrganization);
    const project = encodeURIComponent(config.azureProjectId);
    const separator = path.includes("?") ? "&" : "?";
    const url = `https://dev.azure.com/${organization}/${project}${path}${separator}api-version=${encodeURIComponent(this.apiVersion)}`;
    let response: Response;
    try {
      response = await fetch(url, { method: options.method ?? "GET", headers: { authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`, accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(15_000) });
    } catch { throw new BadGatewayException("Azure DevOps is unavailable"); }
    if (response.status === 401 || response.status === 403) throw new UnauthorizedException("Azure DevOps credential was rejected");
    if (!response.ok) throw new BadGatewayException(`Azure DevOps request failed with status ${response.status}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  private async requestOrg<T>(organization: string, pat: string, path: string): Promise<T> {
    const org = encodeURIComponent(organization);
    const separator = path.includes("?") ? "&" : "?";
    const url = `https://dev.azure.com/${org}${path}${separator}api-version=${encodeURIComponent(this.apiVersion)}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch { throw new BadGatewayException("Azure DevOps is unavailable"); }
    if (response.status === 401 || response.status === 403) throw new UnauthorizedException("Azure DevOps credential was rejected");
    if (!response.ok) throw new BadGatewayException(`Azure DevOps request failed with status ${response.status}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}

function sanitizeCloneUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["dev.azure.com", "visualstudio.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new BadGatewayException("Azure DevOps returned an unsupported clone URL");
  url.username = ""; url.password = "";
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAzureRepository(value: unknown): value is AzureRepositoryResponse {
  return isRecord(value) && typeof value.id === "string" && typeof value.remoteUrl === "string";
}

function publicationMarker(dedupKey: string): string {
  return `<!-- octob-publication:${dedupKey.replace(/[^A-Za-z0-9:_-]/g, "")} -->`;
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
