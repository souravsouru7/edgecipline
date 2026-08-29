const express = require("express");
const request = require("supertest");
const { Writable } = require("stream");

// A real 4x4 PNG, not just a header: the storage engine now decodes every
// upload before it reaches Cloudinary, so a truncated stub would be rejected
// as corrupt and never exercise the Cloudinary failure path under test.
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1Jr" +
    "AAAAEElEQVR42mMwTlsFRwzEcQAFwhQxXYGmsgAAAABJRU5ErkJggg==",
  "base64"
);

function loadUploadMiddlewareWithCloudinaryError(error) {
  jest.resetModules();

  jest.doMock("../../config", () => ({
    appConfig: {
      env: "development",
      port: 5000,
      upload: {
        maxFileSizeBytes: 2 * 1024 * 1024,
        maxImagePixels: 50 * 1000 * 1000,
      },
      // upload.middleware builds the support-attachment uploader at module
      // load, so this mock has to carry the same shape the real config does.
      support: {
        maxAttachmentsPerMessage: 5,
        maxAttachmentBytes: 5 * 1024 * 1024,
      },
    },
  }));

  jest.doMock("../../utils/logger", () => ({
    logger: {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  }));

  jest.doMock("../../config/cloudinary", () => ({
    uploader: {
      upload_stream: jest.fn((_options, cb) => {
        const writable = new Writable({
          write(_chunk, _encoding, next) {
            next();
          },
        });
        writable.on("finish", () => cb(error));
        return writable;
      }),
      destroy: jest.fn().mockResolvedValue({ result: "ok" }),
    },
  }));

  return require("../../middleware/upload.middleware");
}

function cloudinaryDnsError() {
  return Object.assign(new Error("getaddrinfo ENOTFOUND api.cloudinary.com"), {
    code: "ENOTFOUND",
  });
}

describe("upload.middleware Cloudinary DNS failures", () => {
  afterEach(() => {
    jest.dontMock("../../config");
    jest.dontMock("../../utils/logger");
    jest.dontMock("../../config/cloudinary");
  });

  test("returns 503 for trade evidence uploads when Cloudinary DNS fails", async () => {
    const { createMultiUploadMiddleware } = loadUploadMiddlewareWithCloudinaryError(cloudinaryDnsError());
    const app = express();

    app.post(
      "/upload",
      createMultiUploadMiddleware({
        fieldName: "tradeImages",
        maxCount: 20,
        folderName: "trade-evidence",
        fileSizeBytes: 5 * 1024 * 1024,
      }),
      (_req, res) => res.status(201).json({ ok: true })
    );

    const res = await request(app)
      .post("/upload")
      .attach("tradeImages", PNG_BUFFER, {
        filename: "evidence.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/Image storage is temporarily unavailable/);
  });

  test("returns 503 for OCR screenshot uploads when Cloudinary DNS fails", async () => {
    const { createUploadMiddleware } = loadUploadMiddlewareWithCloudinaryError(cloudinaryDnsError());
    const app = express();

    app.post(
      "/upload",
      createUploadMiddleware({
        fieldName: "image",
        folderName: "trades",
        required: true,
      }),
      (_req, res) => res.status(201).json({ ok: true })
    );

    const res = await request(app)
      .post("/upload")
      .attach("image", PNG_BUFFER, {
        filename: "screenshot.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/Image storage is temporarily unavailable/);
  });
});
