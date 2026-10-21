import { describe, expect, it } from "vitest";
import { BOARD, boardSites, boards, connect } from "./helpers.js";

describe("resources and prompts", () => {
  it("lookout://boards and lookout://boards/{id} read the API; the template lists every board", async () => {
    const { client, calls } = await connect({ "GET /boards": () => boards, "GET /boards/{id}/sites": () => boardSites });
    const list = await client.readResource({ uri: "lookout://boards" });
    expect(JSON.parse((list.contents[0] as { text: string }).text)).toEqual(boards);
    const one = await client.readResource({ uri: `lookout://boards/${BOARD}` });
    expect(JSON.parse((one.contents[0] as { text: string }).text)).toEqual(boardSites);
    expect(calls.at(-1)).toMatchObject({ path: `/boards/${BOARD}/sites`, query: { range: "7d" } });
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["lookout://boards", `lookout://boards/${BOARD}`]);
  });

  it("weekly_brief and why_did_it_drop name the tools to call", async () => {
    const { client } = await connect({});
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["weekly_brief", "why_did_it_drop"]);
    const brief = await client.getPrompt({ name: "weekly_brief", arguments: { board: "Clients" } });
    const text = (brief.messages[0]!.content as { text: string }).text;
    expect(text).toContain('Call get_board for "Clients" with range 7d');
    expect(text).toContain("get_flow");
    const drop = await client.getPrompt({ name: "why_did_it_drop", arguments: { site: "prj_a" } });
    expect((drop.messages[0]!.content as { text: string }).text).toContain("Call get_site for prj_a");
  });
});
