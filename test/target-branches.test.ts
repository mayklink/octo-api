import { describe, expect, it } from "vitest";
import { isTargetBranchAllowed, normalizeTargetBranches } from "../src/modules/reviews/target-branches";

describe("target branches", () => {
  it("matches Azure DevOps refs against configured branch names", () => {
    expect(isTargetBranchAllowed("refs/heads/developer", ["developer"])).toBe(true);
    expect(isTargetBranchAllowed("refs/heads/main", ["developer"])).toBe(false);
  });

  it("normalizes and deduplicates configured branches", () => {
    expect(normalizeTargetBranches([" refs/heads/Developer ", "developer", "main"])).toEqual(["developer", "main"]);
  });
});
