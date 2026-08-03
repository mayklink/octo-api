export type Severity = "info" | "warning" | "error";
export type EncryptedCredential = { algorithm: "A256GCM"; keyId: string; iv: string; ciphertext: string; authTag: string };
export type ReviewFindingContract = { filePath: string; line?: number; severity: Severity; category: string; title: string; description: string; suggestion?: string };
export type ReviewRequestedV2 = {
  schemaVersion: 2; eventId: string; jobId: string; attempt: number; correlationId: string; organizationId: string; repositoryId: string;
  provider: "azure-devops"; pullRequestId: string; sourceCommit: string; targetCommit: string; sourceBranch: string; targetBranch: string;
  clone: { url: string }; sourceControl: { encryptedCredential: EncryptedCredential }; context: { sections: Array<{ title: string; content: string }> };
  engine: { kind: "codex"; model: string; encryptedCredential: EncryptedCredential };
  settings: { prompt: string; severityThreshold?: Severity }; createdAt: string; deadlineAt: string;
};
export type ReviewTimings = { totalMs: number; azureMs: number; repositoryMs: number; contextMs: number; engineMs: number };
export type ReviewCompletedV2 = {
  schemaVersion: 2; eventId: string; causationId: string; correlationId: string; jobId: string; attempt: number; organizationId: string; repositoryId: string; pullRequestId: string;
  sourceCommit: string; targetCommit: string; findings: ReviewFindingContract[];
  summary: { markdown: string; filesReviewed: number; findingsBySeverity: Record<Severity, number>; truncated: boolean };
  engine: { name: string; version?: string; model: string }; policyVersion: string; timings: ReviewTimings; tokenUsage?: { input?: number; output?: number; total?: number }; startedAt: string; completedAt: string;
};
export type ReviewFailureV2 = {
  schemaVersion: 2; eventType: "review.attempt_failed" | "review.failed"; eventId: string; causationId: string; correlationId: string; jobId: string; attempt: number;
  organizationId?: string; repositoryId?: string; pullRequestId?: string;
  failure: { code: string; category: string; retryable: boolean; message: string }; timings?: Partial<ReviewTimings>; failedAt: string;
};
export type ReviewOutcomeV2 = ReviewCompletedV2 | ReviewFailureV2;
