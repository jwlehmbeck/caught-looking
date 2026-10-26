import { describe, expect, it } from "vitest";

import { signRequest } from "@shared/scan/sigv4.ts";

// AWS SigV4 test suite vector "get-vanilla": GET https://example.amazonaws.com/
// at 2015-08-30T12:36:00Z, region us-east-1, service "service".
const CREDENTIALS = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

describe("SigV4", () => {
  it("reproduces the AWS get-vanilla test vector", async () => {
    const signed = await signRequest({
      method: "GET",
      url: "https://example.amazonaws.com/",
      service: "service",
      region: "us-east-1",
      credentials: CREDENTIALS,
      date: new Date("2015-08-30T12:36:00Z"),
      includeContentSha: false,
    });
    expect(signed.canonicalRequest).toBe(
      "GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n" +
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(signed.stringToSign).toBe(
      "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n" +
        "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
    );
    expect(signed.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    expect(signed.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
    expect(signed.headers.host).toBeUndefined();
  });

  it("is deterministic and includes the S3 payload hash header", async () => {
    const run = () =>
      signRequest({
        method: "PUT",
        url: "https://bucket.s3.us-west-2.amazonaws.com/scan/post-1.mp4",
        headers: { "content-type": "video/mp4" },
        body: new TextEncoder().encode("hello"),
        service: "s3",
        region: "us-west-2",
        credentials: CREDENTIALS,
        date: new Date("2026-10-25T10:00:00Z"),
      });
    const a = await run();
    const b = await run();
    expect(a.signature).toBe(b.signature);
    expect(a.headers["x-amz-content-sha256"]).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(a.canonicalRequest.split("\n").at(-2)).toBe("content-type;host;x-amz-content-sha256;x-amz-date");
  });
});
