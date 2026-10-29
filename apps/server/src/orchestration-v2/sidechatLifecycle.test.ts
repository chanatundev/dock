// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { describe, expect, it } from "vite-plus/test";

import {
  isExpiredSidechat,
  latestSidechatActivityAt,
  SIDECHAT_EXPIRED_EXECUTION_MESSAGE,
  sidechatActivityInstantsEqual,
} from "./sidechatLifecycle.ts";

describe("sidechatLifecycle", () => {
  describe("isExpiredSidechat", () => {
    it("returns true when sidechatExpiredAt is present", () => {
      expect(isExpiredSidechat({ sidechatExpiredAt: "2026-10-24T12:00:00.000Z" })).toBe(true);
    });

    it("returns true when expiredAt is present", () => {
      expect(isExpiredSidechat({ expiredAt: "2026-10-24T12:00:00.000Z" })).toBe(true);
    });

    it("returns false when both expired fields are null", () => {
      expect(isExpiredSidechat({ sidechatExpiredAt: null, expiredAt: null })).toBe(false);
    });

    it("returns false when expired fields are undefined", () => {
      expect(isExpiredSidechat({})).toBe(false);
      expect(isExpiredSidechat({ sidechatExpiredAt: undefined })).toBe(false);
    });

    it("returns false when argument is null or undefined", () => {
      expect(isExpiredSidechat(null)).toBe(false);
      expect(isExpiredSidechat(undefined)).toBe(false);
    });
  });

  describe("latestSidechatActivityAt", () => {
    it("returns candidate ISO string when current is null or undefined", () => {
      const candidate = "2026-10-24T10:00:00.000Z";
      expect(latestSidechatActivityAt(null, candidate)).toBe(candidate);
      expect(latestSidechatActivityAt(undefined, candidate)).toBe(candidate);
    });

    it("returns candidate when candidate is later than current", () => {
      const earlier = "2026-10-24T10:00:00.000Z";
      const later = "2026-10-24T11:00:00.000Z";
      expect(latestSidechatActivityAt(earlier, later)).toBe(later);
    });

    it("returns current when current is later than candidate", () => {
      const earlier = "2026-10-24T10:00:00.000Z";
      const later = "2026-10-24T11:00:00.000Z";
      expect(latestSidechatActivityAt(later, earlier)).toBe(later);
    });

    it("canonicalizes equivalent timestamps with timezone offsets", () => {
      const utc = "2026-10-24T10:00:00.000Z";
      const offsetLater = "2026-10-24T12:30:00+02:00"; // 10:30:00 UTC
      expect(latestSidechatActivityAt(utc, offsetLater)).toBe("2026-10-24T10:30:00.000Z");
    });

    it("handles invalid candidate timestamp gracefully", () => {
      const valid = "2026-10-24T10:00:00.000Z";
      expect(latestSidechatActivityAt(valid, "not-a-date")).toBe(valid);
      expect(latestSidechatActivityAt(null, "not-a-date")).toBe("not-a-date");
    });

    it("handles invalid current timestamp gracefully", () => {
      const valid = "2026-10-24T10:00:00.000Z";
      expect(latestSidechatActivityAt("not-a-date", valid)).toBe(valid);
    });
  });

  describe("sidechatActivityInstantsEqual", () => {
    it("returns true for identical timestamp strings", () => {
      const stamp = "2026-10-24T10:00:00.000Z";
      expect(sidechatActivityInstantsEqual(stamp, stamp)).toBe(true);
    });

    it("returns true for equivalent instants with different offsets", () => {
      const utc = "2026-10-24T10:00:00.000Z";
      const offset = "2026-10-24T12:00:00+02:00";
      expect(sidechatActivityInstantsEqual(utc, offset)).toBe(true);
    });

    it("returns false for different instants", () => {
      const stamp1 = "2026-10-24T10:00:00.000Z";
      const stamp2 = "2026-10-24T10:00:01.000Z";
      expect(sidechatActivityInstantsEqual(stamp1, stamp2)).toBe(false);
    });

    it("falls back to string equality for non-date strings", () => {
      expect(sidechatActivityInstantsEqual("invalid-1", "invalid-1")).toBe(true);
      expect(sidechatActivityInstantsEqual("invalid-1", "invalid-2")).toBe(false);
    });
  });

  describe("SIDECHAT_EXPIRED_EXECUTION_MESSAGE", () => {
    it("has the expected guard message", () => {
      expect(SIDECHAT_EXPIRED_EXECUTION_MESSAGE).toBe(
        "This side chat expired after a period of inactivity. Start a new side chat.",
      );
    });
  });
});
