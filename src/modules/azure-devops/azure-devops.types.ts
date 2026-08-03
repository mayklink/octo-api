export type AzureRepositoryConfig = { azureOrganization: string; azureProjectId: string; azureRepositoryId: string; cloneUrl: string };
export type AzurePullRequest = {
  id: string; title: string; status: string; sourceBranch: string; targetBranch: string; sourceCommit: string; targetCommit: string; raw: Record<string, unknown>;
};
export type AzureContext = { pullRequest: Record<string, unknown>; workItems: unknown[]; threads: unknown[] };
