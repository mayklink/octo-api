import { BadGatewayException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ReviewFinding } from "@prisma/client";
import type { AzureContext, AzurePullRequest, AzureRepositoryConfig } from "./azure-devops.types";

@Injectable()
export class AzureDevOpsAdapter {
  private readonly apiVersion: string;
  constructor(config: ConfigService) { this.apiVersion = config.get("azure.apiVersion", "7.1"); }

  async validateConnection(config: AzureRepositoryConfig, pat: string): Promise<{ name: string; cloneUrl: string }> {
    const repository = await this.request<any>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}`);
    if (!repository?.id || !repository?.remoteUrl) throw new BadGatewayException("Azure DevOps returned an invalid repository");
    return { name: String(repository.name), cloneUrl: sanitizeCloneUrl(String(repository.remoteUrl)) };
  }

  async getPullRequest(config: AzureRepositoryConfig, pat: string, pullRequestId: string): Promise<AzurePullRequest> {
    const value = await this.request<any>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}`);
    const sourceCommit = String(value?.lastMergeSourceCommit?.commitId ?? "");
    const targetCommit = String(value?.lastMergeTargetCommit?.commitId ?? "");
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

  async publishFinding(config: AzureRepositoryConfig, pat: string, pullRequestId: string, finding: ReviewFinding): Promise<string> {
    const content = [`**${finding.severity.toUpperCase()}: ${finding.title}**`, finding.description, finding.suggestion ? `\nSugestão:\n${finding.suggestion}` : ""].filter(Boolean).join("\n\n");
    const body: Record<string, unknown> = { comments: [{ parentCommentId: 0, content, commentType: 1 }], status: 1 };
    if (finding.line) body.threadContext = { filePath: finding.filePath.startsWith("/") ? finding.filePath : `/${finding.filePath}`, rightFileStart: { line: finding.line, offset: 1 }, rightFileEnd: { line: finding.line, offset: 1 } };
    const created = await this.request<any>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/threads`, { method: "POST", body });
    return String(created.id);
  }

  async publishSummary(config: AzureRepositoryConfig, pat: string, pullRequestId: string, content: string): Promise<string> {
    const created = await this.request<any>(config, pat, `/_apis/git/repositories/${encodeURIComponent(config.azureRepositoryId)}/pullRequests/${encodeURIComponent(pullRequestId)}/threads`, {
      method: "POST",
      body: { comments: [{ parentCommentId: 0, content, commentType: 1 }], status: 1 },
    });
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
