import { newestCliReleaseVersion } from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

// dock is merged from upstream T3 Code nightly tags and carries the merged
// tag's version, so a newer upstream nightly means a sync is available.
const UPSTREAM_REPOSITORY_URL = "https://github.com/pingdotgg/t3code";
// Nightlies ship several times a day, so the first 20 releases always hold one.
const UPSTREAM_RELEASES_API_URL =
  "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=20";

const Releases = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.optionalKey(Schema.Boolean),
  }),
);
const decodeReleases = Schema.decodeUnknownSync(Releases);

/** The newest upstream nightly when it is ahead of `currentVersion`, else null. */
export function resolveNewerUpstreamNightly(
  releases: typeof Releases.Type,
  currentVersion: string,
): string | null {
  const newest = newestCliReleaseVersion(releases, "nightly");
  return newest !== undefined && compareSemverVersions(newest, currentVersion) > 0 ? newest : null;
}

export function upstreamNightlyReleaseUrl(version: string): string {
  return `${UPSTREAM_REPOSITORY_URL}/releases/tag/v${version}`;
}

export async function fetchNewerUpstreamNightly(
  currentVersion: string,
  signal: AbortSignal,
): Promise<string | null> {
  const response = await fetch(UPSTREAM_RELEASES_API_URL, { signal });
  if (!response.ok) throw new Error(`Could not check upstream releases (${response.status}).`);
  return resolveNewerUpstreamNightly(decodeReleases(await response.json()), currentVersion);
}
