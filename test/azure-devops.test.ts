import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureDevOpsAdapter } from "../src/modules/azure-devops/azure-devops.adapter";

const adapter = new AzureDevOpsAdapter(new ConfigService({ azure: { apiVersion: "7.1" } }));
const repository = { azureOrganization: "org", azureProjectId: "project", azureRepositoryId: "repository", cloneUrl: "https://dev.azure.com/org/project/_git/repository" };

afterEach(() => vi.unstubAllGlobals());

describe("AzureDevOpsAdapter", () => {
  it("resolves linked work item references before building review context", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("workitemsbatch")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({ ids: [123], errorPolicy: "Omit" });
        return json({ value: [{ id: 123, fields: { "System.Title": "Acceptance criteria", "System.Description": "Expected behavior" } }] });
      }
      if (url.includes("/workitems?")) return json({ value: [{ id: "123" }] });
      if (url.includes("/threads?")) return json({ value: [{ id: 7 }] });
      if (url.includes("/pullRequests/42?")) return json({ title: "PR", description: "PR description" });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = await adapter.getReviewContext(repository, "pat", "42");

    expect(context.pullRequest).toMatchObject({ description: "PR description" });
    expect(context.workItems).toEqual([{ id: 123, fields: { "System.Title": "Acceptance criteria", "System.Description": "Expected behavior" } }]);
    expect(context.threads).toEqual([{ id: 7 }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("publishes the final summary as a visible pull request comment", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ comments: [{ parentCommentId: 0, content: "## Summary\n\n<!-- octob-publication:job:status -->", commentType: 1 }], status: 1 });
      return json({ id: 99 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(adapter.publishSummary(repository, "pat", "42", "## Summary", "job:status")).resolves.toBe("99");
  });

  it("finds an existing publication by its deterministic marker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ value: [{ id: 77, comments: [{ content: "result\n<!-- octob-publication:job:finding:1 -->" }] }] })));
    await expect(adapter.findPublication(repository, "pat", "42", "job:finding:1")).resolves.toBe("77");
  });

  it("limits project repository discovery concurrency and preserves successful projects", async () => {
    let active = 0;
    let peak = 0;
    const projects = Array.from({ length: 12 }, (_, index) => ({ id: `project-${index}`, name: `Project ${index}` }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/_apis/projects?")) return json({ value: projects });
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (url.includes("project-7")) return new Response("unavailable", { status: 500 });
      const projectId = projects.find((project) => url.includes(project.id))!.id;
      return json({ value: [{ id: `repo-${projectId}`, name: "Repository", remoteUrl: `https://dev.azure.com/org/${projectId}/_git/repository` }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const repositories = await adapter.listRepositories("org", "pat");

    expect(peak).toBeLessThanOrEqual(5);
    expect(repositories).toHaveLength(11);
    expect(repositories.some((item) => item.projectId === "project-7")).toBe(false);
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
