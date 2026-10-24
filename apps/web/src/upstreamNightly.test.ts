import { describe, expect, it } from "vite-plus/test";

import { resolveNewerUpstreamNightly } from "./upstreamNightly";

const releases = [
  { tag_name: "v0.0.46-nightly.20261004.2644" },
  { tag_name: "v0.0.46-preview.20261002.2598" },
  { tag_name: "v0.0.45" },
  { tag_name: "v0.0.45-nightly.20261002.2595" },
];

describe("resolveNewerUpstreamNightly", () => {
  it("offers the newest nightly when dock was merged from an older one", () => {
    expect(resolveNewerUpstreamNightly(releases, "0.0.46-nightly.20261003.2638")).toBe(
      "0.0.46-nightly.20261004.2644",
    );
    expect(resolveNewerUpstreamNightly(releases, "0.0.45-nightly.20261002.2595")).toBe(
      "0.0.46-nightly.20261004.2644",
    );
  });

  it("offers nothing once dock is on the newest nightly", () => {
    expect(resolveNewerUpstreamNightly(releases, "0.0.46-nightly.20261004.2644")).toBeNull();
  });

  it("ignores stable, preview, and draft releases", () => {
    expect(
      resolveNewerUpstreamNightly(
        [
          { tag_name: "v0.0.47-nightly.20261005.2700", draft: true },
          { tag_name: "v0.0.47-preview.20261005.2690" },
          { tag_name: "v0.0.46" },
        ],
        "0.0.45-nightly.20261002.2595",
      ),
    ).toBeNull();
  });

  it("treats a pre-nightly stable version as behind a newer nightly line", () => {
    expect(resolveNewerUpstreamNightly(releases, "0.0.44")).toBe("0.0.46-nightly.20261004.2644");
  });
});
