export function isTargetBranchAllowed(targetBranch: string | undefined, allowedBranches: readonly string[]): boolean {
  if (!targetBranch) return false;
  const target = normalizeBranch(targetBranch);
  return allowedBranches.some((branch) => normalizeBranch(branch) === target);
}

export function normalizeTargetBranches(branches: readonly string[]): string[] {
  return [...new Set(branches.map(normalizeBranch).filter(Boolean))];
}

function normalizeBranch(branch: string): string {
  return branch.trim().replace(/^refs\/heads\//i, "").toLowerCase();
}
