const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectPictureCandidates,
  parseImageResponsePayload,
  summarizeImageResponse,
} = require("../actions/bakecaincontrii/imageResponse");

test("collects the original Bakecaincontrii pictures response", () => {
  const pictures = collectPictureCandidates({
    pictures: [{ uuid: "picture-1", url: "/media/picture-1.jpg" }],
  });

  assert.equal(pictures.length, 1);
  assert.equal(pictures[0].uuid, "picture-1");
  assert.equal(pictures[0].src, "https://bari.bakecaincontrii.com/media/picture-1.jpg");
});

test("parses JSON text and deeply nested alternate image fields", () => {
  const response = JSON.stringify({
    payload: {
      result: {
        uploaded_images: [{
          id: "picture-2",
          file: { url: "/media/picture-2.jpg" },
        }],
      },
    },
  });
  const pictures = collectPictureCandidates(response);

  assert.equal(pictures.length, 1);
  assert.equal(pictures[0].uuid, "picture-2");
  assert.equal(pictures[0].url, "https://bari.bakecaincontrii.com/media/picture-2.jpg");
});

test("supports nested URL maps and keeps distinct uploaded pictures", () => {
  const pictures = collectPictureCandidates({
    data: {
      uploadedPictures: [
        { picture_uuid: "picture-1", urls: { original: "/media/one.jpg" } },
        { imageUuid: "picture-2", urls: { full: "/media/two.jpg" } },
      ],
    },
  });

  assert.deepEqual(pictures.map((picture) => picture.uuid), ["picture-1", "picture-2"]);
});

test("does not treat a successful acknowledgement without image metadata as a picture", () => {
  const response = { success: true, message: "uploaded" };
  const pictures = collectPictureCandidates(response);
  const summary = summarizeImageResponse(response, pictures);

  assert.equal(pictures.length, 0);
  assert.equal(summary.candidateCount, 0);
  assert.match(summary.responseBody, /uploaded/);
});

test("parses JSON buffers returned with an incorrect content type", () => {
  const parsed = parseImageResponsePayload(Buffer.from('{"picture":{"uuid":"buffer-1","src":"/buffer.jpg"}}'));
  assert.equal(parsed.picture.uuid, "buffer-1");
});
